import type { AudioState, KeyName, SystemInfo, SystemStats } from '@fristy/protocol';

export class PlatformError extends Error {
  constructor(
    readonly code: 'unsupported' | 'failed' | 'not_found',
    message: string
  ) {
    super(message);
  }
}

export interface ProcessInfo {
  pid: number;
  name: string;
  path: string | null;
  title: string | null;
}

export interface ScannedGame {
  id: string;
  name: string;
  source: 'steam' | 'epic' | 'ubisoft' | 'ea' | 'rockstar' | 'xbox' | 'battlenet';
  launchKind: 'uri' | 'exe' | 'aumid';
  launchTarget: string;
  installDir: string | null;
  artworkUrl: string | null;
}

export type PowerAction = 'shutdown' | 'restart' | 'sleep' | 'hibernate' | 'lock' | 'monitorOff';

export interface Platform {
  readonly name: string;
  readonly supported: boolean;

  power(action: PowerAction): Promise<void>;
  scheduleShutdown(action: 'shutdown' | 'restart', delaySec: number): Promise<void>;
  cancelShutdown(): Promise<void>;

  mouseMove(dx: number, dy: number): Promise<void>;
  mouseButton(button: 'left' | 'right' | 'middle', action: 'click' | 'double' | 'down' | 'up'): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: KeyName, modifiers: ('ctrl' | 'alt' | 'shift' | 'win')[]): Promise<void>;

  audioState(): Promise<Omit<AudioState, 'nowPlaying'>>;
  setVolume(level: number): Promise<void>;
  setMute(muted: boolean): Promise<void>;
  setMicMute(muted: boolean): Promise<void>;
  setAppVolume(pid: number, level: number | null, muted: boolean | null): Promise<void>;
  setDefaultDevice(deviceId: string): Promise<void>;

  listProcesses(): Promise<ProcessInfo[]>;
  closeProcesses(pids: number[], force: boolean): Promise<number>;
  /** Launches an owner-approved executable directly (no shell). */
  launchExecutable(file: string, args: string[], cwd?: string): Promise<void>;
  /** Opens a launcher protocol URI (steam://, com.epicgames.launcher:// …) – validated by caller. */
  openUri(uri: string): Promise<void>;
  /** Opens an http(s) URL in the default browser – validated by caller. */
  openUrl(url: string): Promise<void>;
  /** Launches a Microsoft Store / Xbox app by its AppUserModelID. */
  launchAumid(aumid: string): Promise<void>;

  scanGames(): Promise<ScannedGame[]>;
  stats(): Promise<Omit<SystemStats, 'ts' | 'runningGame'>>;
  info(): Promise<SystemInfo>;
}
