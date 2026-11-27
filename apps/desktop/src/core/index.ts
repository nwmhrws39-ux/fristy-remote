import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { STATS_INTERVAL_MS, encodePairingQr, type Permission, type SystemStats } from '@fristy/protocol';
import { encodeBase64, fingerprint, type KeyPair } from '@fristy/shared';
import { Store, type DeviceRow } from './db';
import { DiscoveryResponder, advertisedAddresses, lanAddresses, makeBeacon } from './discovery';
import { createHandlers } from './handlers';
import { FristyLauncherClient } from './integrations/fristy-launcher';
import { PairingManager } from './pairing';
import type { Platform } from './platform/types';
import type { DesktopBridge } from './bridge';
import { RelayClient, type RelayStatus } from './relay-client';
import { ControlServer, type PendingPairing, type SessionInfo } from './server';
import { AppService } from './services/apps';
import { FileService } from './services/files';
import { GameService } from './services/games';
import { MacroService } from './services/macros';
import { ProcessCache } from './services/processes';
import { SettingsManager, type Settings } from './settings';
import { OwnerClient, type OwnerStatus } from './owner';

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
  /** location of sql-wasm.wasm when bundled */
  sqlWasmPath?: string;
  /** Electron capabilities (screen capture, clipboard, notifications, shell) */
  desktop?: DesktopBridge;
  /** optional owner service URL (apps/admin-server); empty = disabled */
  ownerApiUrl?: string;
  fetchImpl?: typeof fetch;
  ownerTokenStore?: { get(): string | null; set(token: string | null): void };
  /** live owner updates over WebSocket (default on) */
  ownerLive?: boolean;
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
  owner: OwnerStatus;
}

type CoreEvents = {
  state: [CoreState];
  'pairing-request': [PendingPairing];
  'input-activity': [{ deviceName: string }];
  'screen-activity': [{ deviceName: string }];
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
  readonly owner: OwnerClient;
  /** set while a newer version of FRISTY Remote must be installed first */
  private updateRequired: string | null = null;
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
    this.owner = new OwnerClient({
      apiUrl: opts.ownerApiUrl ?? '',
      store,
      name: () => this.computerName,
      platform: process.platform,
      appVersion: /^\d+\.\d+\.\d+$/.test(opts.appVersion) ? opts.appVersion : '0.0.0',
      fetchImpl: opts.fetchImpl,
      tokenStore: opts.ownerTokenStore,
      live: opts.ownerLive
    });
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
      desktop: opts.desktop,
      log: (level, category, message) => store.log(level, category, message),
      broadcast: (e, d, p) => this.server.broadcast(e, d, p ?? null)
    });
    this.server = new ControlServer({
      store,
      settings: this.settings,
      identity: opts.identity,
      pairing: this.pairing,
      handlers,
      ownerLock: () => this.ownerLockMessage(),
      host: () => ({
        hostId: encodeBase64(opts.identity.publicKey),
        computerName: this.computerName,
        appVersion: opts.appVersion,
        addresses: advertisedAddresses()
      })
    });
    this.relay = new RelayClient(opts.identity, (t) => this.server.attach(t));
    let lastReason: string | null = this.owner.status.locked ? this.owner.status.reason : null;
    this.owner.on('status', (st) => {
      if (st.locked) {
        this.server.disconnectAll(this.ownerLockMessage() || 'FRISTY Remote has been locked by its owner');
        if (lastReason !== st.reason) {
          const what = { blocked: 'This computer was blocked by the app owner', invite: 'This computer is waiting for an invite code', maintenance: 'FRISTY Remote is under scheduled maintenance', locked: 'FRISTY Remote was locked by the app owner' };
          this.store.log('security', 'owner', what[st.reason ?? 'locked']);
        }
      }
      lastReason = st.locked ? st.reason : null;
      this.emitState();
    });

    this.server.on('pairing-request', (p) => {
      this.emit('pairing-request', p);
      this.emitState();
    });
    this.server.on('pairing-resolved', () => this.emitState());
    this.server.on('sessions-changed', () => this.emitState());
    this.server.on('devices-changed', () => this.emitState());
    this.server.on('input-activity', (a) => this.emit('input-activity', a));
    this.server.on('screen-activity', (a) => this.emit('screen-activity', a));
    this.server.on('security', (s) => this.emit('security', s));
    this.relay.on('status', () => this.emitState());
    this.settings.onChange((s, changed) => {
      if (this.started) void this.applySettings(s, changed);
    });
  }

  static async create(opts: CoreOptions): Promise<FristyCore> {
    const store = await Store.open(opts.dataDir ? path.join(opts.dataDir, 'fristy-remote.db') : null, opts.sqlWasmPath);
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
    this.owner.start();
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
    this.owner.stop();
    this.files.dispose();
    await this.server.dispose();
    this.store.close();
  }

  private async applySettings(s: Settings, changed: (keyof Settings)[]) {
    if (changed.includes('screenEnabled')) {
      this.store.log('security', 'screen', `Screen viewing ${s.screenEnabled ? 'enabled' : 'disabled'} by owner`);
    }
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
        hosts: advertisedAddresses().length ? advertisedAddresses() : ['127.0.0.1'],
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

  /** Blocks phone connections until the app is updated (mandatory updates). */
  /** Why phones are refused right now (owner lock or mandatory update), or null. */
  private ownerLockMessage(): string | null {
    if (this.updateRequired) return this.updateRequired;
    const o = this.owner.status;
    if (o.admin) return null;
    // a scheduled maintenance window starts on time, even between check-ins
    const m = o.maintenance;
    if (!o.locked && m && Date.now() >= m.start && Date.now() < m.end) return m.message || 'FRISTY Remote is under maintenance. Try again later.';
    if (!o.locked) return null;
    if (o.reason === 'invite') return 'This computer needs an invite code. Open FRISTY Remote on the PC and enter it.';
    if (o.reason === 'maintenance') return o.message || 'FRISTY Remote is under maintenance. Try again later.';
    return o.message;
  }

  setUpdateRequired(message: string | null) {
    if (message === this.updateRequired) return;
    this.updateRequired = message;
    if (message) {
      this.server.disconnectAll(message);
      this.store.log('info', 'update', message);
    }
    this.emitState();
  }

  /* ---------------- emergency stop ---------------- */

  emergencyStop() {
    this.settings.update({ inputEnabled: false, screenEnabled: false });
    this.store.log('security', 'input', 'Emergency stop: remote input and screen viewing disabled');
  }

  /* ---------------- stats & alerts ---------------- */

  systemInfo() {
    return this.opts.platform.info();
  }

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
      relay: { status: this.relay.status, error: this.relay.lastError },
      owner: this.owner.status
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
