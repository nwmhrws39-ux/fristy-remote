import type { DisplayInfo, ScreenFrame } from '@fristy/protocol';

/**
 * Capabilities that need Electron (screen capture, clipboard, notifications,
 * shell). Implemented in the main process and injected into the core so the
 * core stays testable in plain Node.
 */
export interface DesktopBridge {
  displays(): DisplayInfo[];
  /** Captures one display as JPEG, scaled to at most `maxWidth` physical pixels wide. */
  grab(displayId: string, maxWidth: number, quality: number): Promise<Omit<ScreenFrame, 'ts'>>;
  /** Maps a normalized point (0..1) on a display to physical virtual-desktop pixels. */
  toScreenPoint(displayId: string, nx: number, ny: number): { x: number; y: number };
  clipboardRead(): Promise<string> | string;
  clipboardWrite(text: string): void;
  notify(title: string, body: string): void;
  /** Opens a file with its default application. Resolves to an error message or ''. */
  openPath(file: string): Promise<string>;
}
