import { EventEmitter } from 'node:events';
import { app } from 'electron';
// Named import: the default import is undefined once bundled (CommonJS module with __esModule).
import { autoUpdater } from 'electron-updater';

/*
 * In-app updates from the public releases repository (see docs/UPDATES.md).
 * Updates are mandatory: as soon as a newer version exists the PC stops
 * accepting phone connections until the user clicks "Update now".
 */

export type UpdateState =
  | { status: 'disabled' }
  | { status: 'idle' | 'checking' | 'none'; current: string }
  | { status: 'available' | 'downloading'; current: string; version: string; percent: number }
  | { status: 'ready'; current: string; version: string }
  | { status: 'error'; current: string; error: string };

const CHECK_EVERY_MS = 60 * 60_000;

export class Updater extends EventEmitter<{ state: [UpdateState] }> {
  state: UpdateState = { status: 'disabled' };
  private timer: NodeJS.Timeout | null = null;

  /** True when a newer version exists – the old version must not be used. */
  get required(): boolean {
    return this.state.status === 'available' || this.state.status === 'downloading' || this.state.status === 'ready';
  }

  start() {
    if (!app.isPackaged) return; // dev builds never update themselves
    const current = app.getVersion();
    try {
      this.wire(current);
    } catch (e) {
      this.set({ status: 'error', current, error: (e as Error).message.slice(0, 200) });
    }
  }

  private wire(current: string) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', current }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'none', current }));
    autoUpdater.on('update-available', (i) => this.set({ status: 'available', current, version: i.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) =>
      this.set({ status: 'downloading', current, version: this.state.status === 'available' || this.state.status === 'downloading' ? this.state.version : '', percent: Math.round(p.percent) })
    );
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', current, version: i.version }));
    autoUpdater.on('error', (e) => {
      // Offline or no releases yet: keep working, just report it.
      if (!this.required) this.set({ status: 'error', current, error: (e?.message ?? 'update check failed').slice(0, 200) });
    });
    this.set({ status: 'idle', current });
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  async check() {
    if (this.state.status === 'disabled') return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* reported through the 'error' event */
    }
  }

  /** Quits and runs the downloaded installer (Windows asks for permission once). */
  install() {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall(false, true);
  }

  private set(s: UpdateState) {
    this.state = s;
    this.emit('state', s);
  }
}
