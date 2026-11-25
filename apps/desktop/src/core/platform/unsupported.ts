import { HardwareMonitor } from './monitor';
import { PlatformError, type Platform } from './types';

const unsupported = async (): Promise<never> => {
  throw new PlatformError('unsupported', `Not supported on ${process.platform}. FRISTY Remote targets Windows 10/11.`);
};

/**
 * Used on non-Windows hosts (development and CI). Monitoring works everywhere;
 * every control operation reports "unsupported" instead of pretending to work.
 */
export function createUnsupportedPlatform(opener?: { openExternal(url: string): Promise<void> }): Platform {
  const monitor = new HardwareMonitor();
  return {
    name: process.platform,
    supported: false,
    power: unsupported,
    scheduleShutdown: unsupported,
    cancelShutdown: unsupported,
    mouseMove: unsupported,
    moveCursor: unsupported,
    speak: unsupported,
    mouseButton: unsupported,
    scroll: unsupported,
    typeText: unsupported,
    pressKey: unsupported,
    audioState: unsupported,
    setVolume: unsupported,
    setMute: unsupported,
    setMicMute: unsupported,
    setAppVolume: unsupported,
    setDefaultDevice: unsupported,
    listProcesses: async () => [],
    closeProcesses: unsupported,
    launchExecutable: unsupported,
    openUri: opener ? (u) => opener.openExternal(u) : unsupported,
    openUrl: opener ? (u) => opener.openExternal(u) : unsupported,
    launchAumid: unsupported,
    scanGames: async () => [],
    stats: () => monitor.stats(),
    info: () => monitor.info()
  };
}
