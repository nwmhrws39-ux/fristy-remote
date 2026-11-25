import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioState, KeyName } from '@fristy/protocol';
import { HardwareMonitor } from '../monitor';
import { PlatformError, type Platform, type PowerAction, type ProcessInfo } from '../types';
import { scanAllGames } from './games';
import { NativeHelper } from './helper';
import { MODIFIER_VK, VK } from './keys';

const execFileAsync = promisify(execFile);

export interface Opener {
  openExternal(url: string): Promise<void>;
}

/** AppUserModelID, e.g. "Microsoft.MinecraftUWP_8wekyb3d8bbwe!App" */
const AUMID_RE = /^[A-Za-z0-9._-]{1,128}_[a-z0-9]{13}![A-Za-z0-9._-]{1,64}$/;

async function shutdownExe(args: string[]): Promise<void> {
  try {
    await execFileAsync('shutdown.exe', args, { windowsHide: true });
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    throw new PlatformError('failed', msg);
  }
}

export function createWindowsPlatform(helperScript: string, opener: Opener): Platform & { dispose(): void } {
  const helper = new NativeHelper(helperScript);
  const monitor = new HardwareMonitor();

  return {
    name: 'windows',
    supported: true,
    dispose: () => helper.stop(),

    async power(action: PowerAction) {
      switch (action) {
        case 'shutdown':
          return shutdownExe(['/s', '/t', '0']);
        case 'restart':
          return shutdownExe(['/r', '/t', '0']);
        case 'sleep':
          await helper.call('sleep');
          return;
        case 'hibernate':
          await helper.call('hibernate');
          return;
        case 'lock':
          await helper.call('lock');
          return;
        case 'monitorOff':
          await helper.call('monitorOff');
          return;
      }
    },
    scheduleShutdown: (action, delaySec) =>
      shutdownExe([action === 'restart' ? '/r' : '/s', '/t', String(delaySec), '/c', 'Scheduled by FRISTY Remote']),
    cancelShutdown: () => shutdownExe(['/a']),

    async mouseMove(dx, dy) {
      await helper.call('mouseMove', { dx, dy });
    },
    async moveCursor(x, y) {
      await helper.call('moveTo', { x: Math.round(x), y: Math.round(y) });
    },
    async speak(text) {
      await helper.call('speak', { text });
    },
    async mouseButton(button, action) {
      await helper.call('mouseButton', { button, action });
    },
    async scroll(dx, dy) {
      await helper.call('scroll', { dx, dy });
    },
    async typeText(text) {
      await helper.call('text', { text });
    },
    async pressKey(key: KeyName, modifiers) {
      const vk = VK[key];
      if (vk === undefined) throw new PlatformError('not_found', 'unknown key');
      await helper.call('combo', { vk, modifiers: modifiers.map((m) => MODIFIER_VK[m]) });
    },

    async audioState() {
      const s = await helper.call<Omit<AudioState, 'nowPlaying'>>('audioState');
      return {
        volume: s.volume ?? null,
        muted: s.muted ?? null,
        micMuted: s.micMuted ?? null,
        sessions: Array.isArray(s.sessions) ? s.sessions : [],
        outputs: Array.isArray(s.outputs) ? s.outputs : [],
        inputs: Array.isArray(s.inputs) ? s.inputs : []
      };
    },
    async setVolume(level) {
      await helper.call('setVolume', { level });
    },
    async setMute(muted) {
      await helper.call('setMute', { muted });
    },
    async setMicMute(muted) {
      await helper.call('setMicMute', { muted });
    },
    async setAppVolume(pid, level, muted) {
      await helper.call('setAppVolume', { pid, level: level ?? -1, mute: muted === null ? -1 : muted ? 1 : 0 });
    },
    async setDefaultDevice(deviceId) {
      await helper.call('setDefaultDevice', { deviceId });
    },

    async listProcesses() {
      const list = await helper.call<ProcessInfo[] | ProcessInfo>('processes', {}, 20_000);
      return Array.isArray(list) ? list : [list];
    },
    async closeProcesses(pids, force) {
      if (!pids.length) return 0;
      return helper.call<number>('close', { pids, force, timeoutMs: force ? 8000 : 4000 }, 30_000);
    },
    async launchExecutable(file, args, cwd) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.once('error', (e) => reject(new PlatformError('failed', e.message)));
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
    },
    openUri: (uri) => opener.openExternal(uri),
    openUrl: (url) => opener.openExternal(url),
    async launchAumid(aumid) {
      if (!AUMID_RE.test(aumid)) throw new PlatformError('failed', 'invalid AppUserModelID');
      const child = spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], { detached: true, stdio: 'ignore', shell: false });
      child.unref();
    },

    scanGames: scanAllGames,
    stats: () => monitor.stats(),
    info: () => monitor.info()
  };
}
