import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { STATS_INTERVAL_MS, encodePairingQr, type Permission, type SystemStats } from '@fristy/protocol';
import { encodeBase64, fingerprint, type KeyPair } from '@fristy/shared';
import { Store, type DeviceRow } from './db';
import { DiscoveryResponder, lanAddresses, makeBeacon } from './discovery';
import { createHandlers } from './handlers';
import { FristyLauncherClient } from './integrations/fristy-launcher';
import { PairingManager } from './pairing';
import type { Platform } from './platform/types';
import { RelayClient, type RelayStatus } from './relay-client';
import { ControlServer, type PendingPairing, type SessionInfo } from './server';
import { AppService } from './services/apps';
import { FileService } from './services/files';
import { GameService } from './services/games';
import { MacroService } from './services/macros';
import { ProcessCache } from './services/processes';
import { SettingsManager, type Settings } from './settings';

export interface CoreOptions {
  /** directory for the database; null = in-memory (tests) */
  dataDir: string | null;
  platform: Platform;
  identity: KeyPair;
  identityPersisted: boolean;
  appVersion: string;
  computerName?: string;
  iconFor?: (exe: string) => Promise<string | null>;
  launcherToken?: () => string | null;
  /** disable UDP discovery (tests) */
  discovery?: boolean;
}

export interface PairingView {
  pairingId: string;
  code: string;
  expiresAt: number;
  qrText: string;
}

export interface CoreState {
  settings: Settings;
  listening: boolean;
  listenError: string | null;
  port: number;
  addresses: string[];
  fingerprint: string;
  identityPersisted: boolean;
  platform: { name: string; supported: boolean };
  devices: DeviceRow[];
  sessions: SessionInfo[];
  pending: PendingPairing[];
  pairing: PairingView | null;
  relay: { status: RelayStatus; error: string | null };
}

type CoreEvents = {
  state: [CoreState];
  'pairing-request': [PendingPairing];
  'input-activity': [{ deviceName: string }];
  security: [{ message: string; remote: string }];
};

export class FristyCore extends EventEmitter<CoreEvents> {
  readonly settings: SettingsManager;
  readonly server: ControlServer;
  readonly pairing = new PairingManager();
  readonly apps: AppService;
  readonly games: GameService;
  readonly files: FileService;
  readonly macros: MacroService;
  readonly procs: ProcessCache;
  private discovery: DiscoveryResponder | null = null;
  private relay: RelayClient;
  private statsTimer: NodeJS.Timeout | null = null;
  private lastAlert = new Map<string, number>();
  private listenError: string | null = null;
  private port = 0;
  private stateTimer: NodeJS.Timeout | null = null;
  private started = false;

  private constructor(
    readonly store: Store,
    private readonly opts: CoreOptions
  ) {
    super();
    this.settings = new SettingsManager(store);
    this.procs = new ProcessCache(opts.platform);
    const launcher = () => {
      const s = this.settings.get();
      if (!s.launcherIntegration) return null;
      try {
        return new FristyLauncherClient(s.launcherApiUrl, opts.launcherToken ?? (() => null));
      } catch {
        return null;
      }
    };
    this.apps = new AppService(store, opts.platform, this.procs, opts.iconFor);
    this.games = new GameService(
      store,
      opts.platform,
      this.procs,
      (g) => this.server?.broadcast('alert', { type: 'gameLaunched', message: g.name }, 'games'),
      launcher()
    );
    this.files = new FileService(
      store,
      () => this.settings.get().maxTransferMB * 1024 * 1024,
      (t) => this.server?.broadcast('alert', { type: 'transferComplete', message: t.name }, 'files')
    );
    this.macros = new MacroService(store);
    const handlers = createHandlers({
      platform: opts.platform,
      apps: this.apps,
      games: this.games,
      files: this.files,
      macros: this.macros,
      procs: this.procs,
      stats: () => this.stats(),
      broadcast: (e, d, p) => this.server.broadcast(e, d, p ?? null)
    });
    this.server = new ControlServer({
      store,
      settings: this.settings,
      identity: opts.identity,
      pairing: this.pairing,
      handlers,
      host: () => ({
        hostId: encodeBase64(opts.identity.publicKey),
        computerName: this.computerName,
        appVersion: opts.appVersion
      })
    });
    this.relay = new RelayClient(opts.identity, (t) => this.server.attach(t));

    this.server.on('pairing-request', (p) => {
      this.emit('pairing-request', p);
      this.emitState();
    });
    this.server.on('pairing-resolved', () => this.emitState());
    this.server.on('sessions-changed', () => this.emitState());
    this.server.on('devices-changed', () => this.emitState());
    this.server.on('input-activity', (a) => this.emit('input-activity', a));
    this.server.on('security', (s) => this.emit('security', s));
    this.relay.on('status', () => this.emitState());
    this.settings.onChange((s, changed) => {
      if (this.started) void this.applySettings(s, changed);
    });
  }

  static async create(opts: CoreOptions): Promise<FristyCore> {
    const store = await Store.open(opts.dataDir ? path.join(opts.dataDir, 'fristy-remote.db') : null);
    return new FristyCore(store, opts);
  }

  get computerName(): string {
    return this.opts.computerName ?? os.hostname();
  }

  get publicKey(): string {
    return encodeBase64(this.opts.identity.publicKey);
  }

  async start(): Promise<void> {
    this.started = true;
    this.macros.seedDefaults();
    if (this.opts.platform.supported) {
      void this.apps.addDetectedPresets().catch(() => undefined);
      void this.games.rescan().catch(() => undefined);
    }
    this.games.startTracking();
    await this.applySettings(this.settings.get(), ['remoteEnabled', 'relayEnabled']);
    this.statsTimer = setInterval(() => void this.statsTick(), STATS_INTERVAL_MS);
    this.statsTimer.unref();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.games.stopTracking();
    this.discovery?.stop();
    this.relay.stop();
    this.files.dispose();
    await this.server.dispose();
    this.store.close();
  }

  private async applySettings(s: Settings, changed: (keyof Settings)[]) {
    if (changed.includes('inputEnabled')) {
      this.server.broadcast('inputState', { enabled: s.inputEnabled });
      this.store.log('security', 'input', `Remote input ${s.inputEnabled ? 'enabled' : 'disabled'} by owner`);
    }
    if (changed.includes('remoteEnabled') || changed.includes('port')) {
      if (s.remoteEnabled) {
        try {
          this.port = await this.server.listen(s.port);
          this.listenError = null;
          if (this.opts.discovery !== false) {
            this.discovery ??= new DiscoveryResponder(() =>
              makeBeacon(this.computerName, this.publicKey, this.port, this.pairing.current()?.pairingId ?? null)
            );
            await this.discovery.start().catch((e: Error) => {
              this.store.log('warn', 'network', `Discovery unavailable: ${e.message}`);
            });
          }
        } catch (e) {
          this.listenError = (e as Error).message;
          this.store.log('warn', 'network', `Cannot listen on port ${s.port}: ${this.listenError}`);
        }
      } else {
        await this.server.stopListening();
        this.discovery?.stop();
        this.discovery = null;
      }
    }
    if (changed.includes('relayEnabled') || changed.includes('relayUrl') || changed.includes('remoteEnabled')) {
      if (s.remoteEnabled && s.relayEnabled && s.relayUrl) this.relay.start(s.relayUrl);
      else this.relay.stop();
    }
    this.emitState();
  }

  /* ---------------- pairing ---------------- */

  createPairing(): PairingView {
    const p = this.pairing.create();
    this.store.log('info', 'pairing', 'Pairing code generated');
    this.emitState();
    return this.pairingView()!;
  }

  private pairingView(): PairingView | null {
    const p = this.pairing.current();
    if (!p) return null;
    return {
      pairingId: p.pairingId,
      code: p.code,
      expiresAt: p.expiresAt,
      qrText: encodePairingQr({
        v: 1,
        pk: this.publicKey,
        pid: p.pairingId,
        secret: p.secret,
        hosts: (lanAddresses().length ? lanAddresses() : ['127.0.0.1']).slice(0, 4),
        port: this.port || this.settings.get().port,
        name: this.computerName.slice(0, 64),
        exp: p.expiresAt
      })
    };
  }

  cancelPairing() {
    this.pairing.cancel();
    this.emitState();
  }

  approvePairing(id: string, permissions: Permission[]) {
    this.server.approvePairing(id, permissions);
  }

  denyPairing(id: string) {
    this.server.denyPairing(id);
  }

  /* ---------------- emergency stop ---------------- */

  emergencyStop() {
    this.settings.update({ inputEnabled: false });
    this.store.log('security', 'input', 'Emergency stop: remote input disabled');
  }

  /* ---------------- stats & alerts ---------------- */

  async stats(): Promise<SystemStats> {
    const base = await this.opts.platform.stats();
    return { ...base, ts: Date.now(), runningGame: this.games.currentGame() };
  }

  private async statsTick() {
    if (!this.server.hasStatsSubscribers()) return;
    try {
      const st = await this.stats();
      this.server.pushStats(st);
      this.checkAlerts(st);
    } catch {
      /* transient sampling errors are ignored */
    }
  }

  private checkAlerts(st: SystemStats) {
    const s = this.settings.get();
    const fire = (type: 'cpuTemp' | 'gpuTemp' | 'lowStorage', message: string) => {
      const last = this.lastAlert.get(type) ?? 0;
      if (Date.now() - last < 15 * 60_000) return;
      this.lastAlert.set(type, Date.now());
      this.server.broadcast('alert', { type, message }, 'monitor');
    };
    if (st.cpuTemp !== null && st.cpuTemp >= s.alertCpuTemp) fire('cpuTemp', `CPU at ${Math.round(st.cpuTemp)}°C`);
    if (st.gpuTemp !== null && st.gpuTemp >= s.alertGpuTemp) fire('gpuTemp', `GPU at ${Math.round(st.gpuTemp)}°C`);
    if (st.diskFree !== null && st.diskTotal) {
      const pct = (st.diskFree / st.diskTotal) * 100;
      if (pct <= s.alertLowStoragePct) fire('lowStorage', `${pct.toFixed(0)}% storage free`);
    }
  }

  /* ---------------- state for the UI ---------------- */

  state(): CoreState {
    return {
      settings: this.settings.get(),
      listening: this.server.listening,
      listenError: this.listenError,
      port: this.port,
      addresses: lanAddresses(),
      fingerprint: fingerprint(this.opts.identity.publicKey),
      identityPersisted: this.opts.identityPersisted,
      platform: { name: this.opts.platform.name, supported: this.opts.platform.supported },
      devices: this.store.listDevices(),
      sessions: this.server.sessionsInfo(),
      pending: this.server.pendingPairings(),
      pairing: this.pairingView(),
      relay: { status: this.relay.status, error: this.relay.lastError }
    };
  }

  /** Coalesces bursts of changes into one UI update. */
  emitState() {
    if (this.stateTimer || !this.started) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.emit('state', this.state());
    }, 30);
  }
}

export type { Settings, DeviceRow, PendingPairing, SessionInfo };
