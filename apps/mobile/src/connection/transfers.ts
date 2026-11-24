import { Directory, File, Paths } from 'expo-file-system';
import { decodeBase64, encodeBase64 } from '@fristy/shared';
import { connection } from './manager';

/*
 * File transfers over the encrypted control channel, chunk by chunk.
 * Downloads pull chunks (natural back-pressure); uploads push sequential
 * chunks the PC verifies by index. Transfers survive screen changes but not
 * app restarts; pausing simply stops requesting/sending chunks.
 */

export interface LocalTransfer {
  id: string;
  remoteId: string | null;
  direction: 'upload' | 'download';
  name: string;
  size: number;
  done: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  localUri: string | null;
  mime: string | null;
}

let transfers: LocalTransfer[] = [];
const listeners = new Set<() => void>();
const control = new Map<string, { paused: boolean; cancelled: boolean; resume?: () => void }>();

export const transferStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => transfers
};

function update(id: string, patch: Partial<LocalTransfer>) {
  transfers = transfers.map((t) => (t.id === id ? { ...t, ...patch } : t));
  for (const l of listeners) l();
}

function add(t: LocalTransfer) {
  transfers = [t, ...transfers].slice(0, 50);
  control.set(t.id, { paused: false, cancelled: false });
  for (const l of listeners) l();
}

async function gate(id: string) {
  const c = control.get(id)!;
  if (c.paused) await new Promise<void>((r) => (c.resume = r));
  if (c.cancelled) throw new Error('cancelled');
}

export function downloadsDir(): Directory {
  const d = new Directory(Paths.document, 'FRISTY');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

function uniqueFile(dir: Directory, name: string): File {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let f = new File(dir, name);
  for (let i = 1; f.exists && i < 1000; i++) f = new File(dir, `${base} (${i})${ext}`);
  return f;
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', heic: 'image/heic', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska' };
export const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

export async function startDownload(rootId: string, path: string): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const info = await connection.call('files.downloadStart', { rootId, path });
  add({ id, remoteId: info.transferId, direction: 'download', name: info.name, size: info.size, done: 0, status: 'active', error: null, localUri: null, mime: mimeOf(info.name) });
  const file = uniqueFile(downloadsDir(), info.name);
  file.create();
  const handle = file.open();
  try {
    for (let i = 0; i < info.chunks; i++) {
      await gate(id);
      const chunk = await connection.call('files.downloadChunk', { transferId: info.transferId, index: i }, 60_000);
      const bytes = decodeBase64(chunk.data);
      await handle.writeBytes(bytes);
      update(id, { done: Math.min(info.size, (i + 1) * info.chunkSize) });
      if (chunk.last) break;
    }
    handle.close();
    update(id, { status: 'completed', done: info.size, localUri: file.uri });
  } catch (e) {
    handle.close();
    const cancelled = control.get(id)?.cancelled;
    if (file.exists) file.delete();
    void connection.call('files.cancel', { transferId: info.transferId }).catch(() => undefined);
    update(id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : (e as Error).message });
  }
}

export async function startUpload(rootId: string, dir: string, uri: string, name: string, size: number): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  add({ id, remoteId: null, direction: 'upload', name, size, done: 0, status: 'active', error: null, localUri: uri, mime: mimeOf(name) });
  let remoteId: string | null = null;
  const file = new File(uri);
  const handle = file.open();
  try {
    const started = await connection.call('files.uploadStart', { rootId, dir, name, size });
    remoteId = started.transferId;
    update(id, { remoteId });
    let sent = 0;
    for (let index = 0; sent < size; index++) {
      await gate(id);
      const bytes = await handle.readBytes(Math.min(started.chunkSize, size - sent));
      if (bytes.length === 0) throw new Error('file ended early');
      await connection.call('files.uploadChunk', { transferId: remoteId, index, data: encodeBase64(bytes) }, 60_000);
      sent += bytes.length;
      update(id, { done: sent });
    }
    handle.close();
    await connection.call('files.finish', { transferId: remoteId });
    update(id, { status: 'completed', done: size });
  } catch (e) {
    handle.close();
    const cancelled = control.get(id)?.cancelled;
    if (remoteId) void connection.call('files.cancel', { transferId: remoteId }).catch(() => undefined);
    update(id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : (e as Error).message });
  }
}

export function pauseTransfer(id: string, paused: boolean) {
  const c = control.get(id);
  const t = transfers.find((x) => x.id === id);
  if (!c || !t || (t.status !== 'active' && t.status !== 'paused')) return;
  c.paused = paused;
  if (t.remoteId) void connection.call('files.pause', { transferId: t.remoteId, paused }).catch(() => undefined);
  if (!paused) {
    c.resume?.();
    c.resume = undefined;
  }
  update(id, { status: paused ? 'paused' : 'active' });
}

export function cancelTransfer(id: string) {
  const c = control.get(id);
  if (!c) return;
  c.cancelled = true;
  c.paused = false;
  c.resume?.();
}
