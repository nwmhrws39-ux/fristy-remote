import path from 'node:path';
import { BrowserWindow, desktopCapturer, screen, type WebContents } from 'electron';

/*
 * Fast screen capture for remote viewing.
 *
 * Instead of taking a new desktopCapturer screenshot for every frame (slow:
 * ~100–300 ms each), a hidden, sandboxed window keeps a live video stream of
 * the selected display and encodes the latest video frame to JPEG on demand
 * (typically 10–30 ms). Falls back to desktopCapturer thumbnails if the stream
 * cannot start. The stream stops after a short idle period.
 */

const IDLE_MS = 20_000;

let win: BrowserWindow | null = null;
let current: { displayId: string; started: Promise<boolean> } | null = null;
let idleTimer: NodeJS.Timeout | null = null;

export function isCaptureContents(wc: WebContents): boolean {
  return !!win && !win.isDestroyed() && wc.id === win.webContents.id;
}

function displayById(id: string) {
  return screen.getAllDisplays().find((d) => String(d.id) === id);
}

function stopSoon() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    current = null;
    win?.destroy();
    win = null;
  }, IDLE_MS);
  idleTimer.unref();
}

async function ensureWindow(rendererDir: string, devUrl?: string): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await (devUrl ? win.loadURL(`${devUrl}/capture.html`) : win.loadFile(path.join(rendererDir, 'capture.html')));
  return win;
}

async function startStream(displayId: string, rendererDir: string, devUrl?: string): Promise<boolean> {
  const d = displayById(displayId);
  if (!d) return false;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const src = sources.find((s) => s.display_id === displayId) ?? (sources.length === 1 ? sources[0] : undefined);
  if (!src) return false;
  const w = await ensureWindow(rendererDir, devUrl);
  const maxW = Math.round(d.size.width * d.scaleFactor);
  const maxH = Math.round(d.size.height * d.scaleFactor);
  try {
    return (await Promise.race([
      w.webContents.executeJavaScript(`window.__fristyStart(${JSON.stringify(src.id)}, ${maxW}, ${maxH})`),
      new Promise((r) => setTimeout(() => r(false), 6000))
    ])) as boolean;
  } catch {
    return false;
  }
}

/** Cursor position on a display, normalized 0..1, or null when it is on another display. */
export function cursorOn(displayId: string): { x: number; y: number } | null {
  const d = displayById(displayId);
  if (!d) return null;
  const p = screen.getCursorScreenPoint();
  const b = d.bounds;
  if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return null;
  return { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height };
}

async function thumbnailGrab(displayId: string, maxWidth: number, quality: number) {
  const d = displayById(displayId);
  if (!d) throw new Error('display not found');
  const physW = d.size.width * d.scaleFactor;
  const physH = d.size.height * d.scaleFactor;
  const scale = Math.min(1, maxWidth / physW);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(physW * scale), height: Math.round(physH * scale) }
  });
  const src = sources.find((s) => s.display_id === displayId) ?? (sources.length === 1 ? sources[0] : undefined);
  if (!src || src.thumbnail.isEmpty()) throw new Error('screen capture unavailable');
  const size = src.thumbnail.getSize();
  return { w: size.width, h: size.height, data: src.thumbnail.toJPEG(quality).toString('base64') };
}

export async function grabFrame(displayId: string, maxWidth: number, quality: number, rendererDir: string, devUrl?: string) {
  stopSoon();
  if (!current || current.displayId !== displayId) {
    current = { displayId, started: startStream(displayId, rendererDir, devUrl) };
  }
  const cursor = cursorOn(displayId);
  if (await current.started) {
    try {
      const r = (await win!.webContents.executeJavaScript(`window.__fristyGrab(${Math.round(maxWidth)}, ${quality / 100})`)) as
        | { w: number; h: number; data: string }
        | null;
      if (r && r.data) return { ...r, cursor };
    } catch {
      /* fall through to the thumbnail path */
    }
  }
  return { ...(await thumbnailGrab(displayId, maxWidth, quality)), cursor };
}

export function stopCapture() {
  current = null;
  win?.destroy();
  win = null;
}
