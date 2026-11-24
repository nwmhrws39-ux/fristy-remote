import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FILE_CHUNK_BYTES, type FileItem, type SharedRoot, type TransferRecord } from '@fristy/protocol';
import { randomId } from '@fristy/shared';
import type { SharedFolderRow, Store, TransferRow } from '../db';

export class FileError extends Error {
  constructor(
    readonly code: 'forbidden' | 'not_found' | 'bad_request' | 'limit_exceeded',
    message: string
  ) {
    super(message);
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Validates a single file name for uploads. */
export function validateFileName(name: string): string {
  const n = name.normalize('NFC');
  if (!n || n.length > 255) throw new FileError('bad_request', 'invalid file name');
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) throw new FileError('bad_request', 'file name contains forbidden characters');
  if (n === '.' || n === '..' || /[. ]$/.test(n)) throw new FileError('bad_request', 'invalid file name');
  if (WINDOWS_RESERVED.test(n)) throw new FileError('bad_request', 'reserved file name');
  return n;
}

/**
 * Resolves a client-supplied relative path inside a shared root.
 * Rejects traversal (`..`), absolute paths, drive letters, UNC paths,
 * alternate data streams (`:`) and symlinks/junctions that escape the root.
 */
export async function resolveInside(root: string, rel: string, mustExist: boolean): Promise<string> {
  if (rel.includes('\0')) throw new FileError('forbidden', 'invalid path');
  const segments = rel.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');
  for (const s of segments) {
    if (s === '..' || s.includes(':')) throw new FileError('forbidden', 'path escapes the shared folder');
  }
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...segments);
  const within = (p: string, r: string) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  if (!within(candidate, rootResolved)) throw new FileError('forbidden', 'path escapes the shared folder');

  // Resolve symlinks/junctions on the deepest existing ancestor and re-check.
  let realRoot: string;
  try {
    realRoot = await fsp.realpath(rootResolved);
  } catch {
    throw new FileError('not_found', 'shared folder is not available');
  }
  let probe = candidate;
  let suffix: string[] = [];
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      const finalPath = path.join(real, ...suffix);
      if (!within(finalPath, realRoot)) throw new FileError('forbidden', 'path escapes the shared folder');
      if (mustExist && suffix.length) throw new FileError('not_found', 'not found');
      return finalPath;
    } catch (e) {
      if (e instanceof FileError) throw e;
      if (probe === rootResolved) throw new FileError('not_found', 'not found');
      suffix = [path.basename(probe), ...suffix];
      probe = path.dirname(probe);
      if (mustExist) throw new FileError('not_found', 'not found');
    }
  }
}

interface ActiveTransfer {
  row: TransferRow;
  handle: fsp.FileHandle;
  filePath: string;
  finalPath?: string;
  nextIndex: number;
  touched: number;
}

const MAX_ACTIVE_PER_DEVICE = 4;

export class FileService {
  private active = new Map<string, ActiveTransfer>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private readonly maxBytes: () => number,
    private readonly onComplete: (row: TransferRow) => void = () => undefined
  ) {
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref();
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const id of [...this.active.keys()]) void this.abort(id, 'cancelled');
  }

  roots(): SharedRoot[] {
    return this.store.listSharedFolders().map((f) => ({ id: f.id, name: f.name, writable: f.writable }));
  }

  private root(id: string): SharedFolderRow {
    const r = this.store.listSharedFolders().find((f) => f.id === id);
    if (!r) throw new FileError('not_found', 'shared folder not found');
    return r;
  }

  async list(rootId: string, rel: string): Promise<FileItem[]> {
    const dir = await resolveInside(this.root(rootId).path, rel, true);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items: FileItem[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // never follow links out of the share
      if (!e.isFile() && !e.isDirectory()) continue;
      if (e.name.endsWith('.fristy-part')) continue; // in-progress uploads
      try {
        const st = await fsp.stat(path.join(dir, e.name));
        items.push({ name: e.name, dir: e.isDirectory(), size: e.isFile() ? st.size : 0, mtime: st.mtimeMs });
      } catch {
        /* skip entries we cannot stat */
      }
    }
    return items.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  private checkCapacity(deviceId: string) {
    const n = [...this.active.values()].filter((t) => t.row.deviceId === deviceId).length;
    if (n >= MAX_ACTIVE_PER_DEVICE) throw new FileError('limit_exceeded', 'too many active transfers');
  }

  private get(deviceId: string, transferId: string): ActiveTransfer {
    const t = this.active.get(transferId);
    if (!t || t.row.deviceId !== deviceId) throw new FileError('not_found', 'transfer not found');
    t.touched = Date.now();
    return t;
  }

  async downloadStart(deviceId: string, rootId: string, rel: string) {
    this.checkCapacity(deviceId);
    const filePath = await resolveInside(this.root(rootId).path, rel, true);
    const st = await fsp.stat(filePath);
    if (!st.isFile()) throw new FileError('bad_request', 'not a file');
    if (st.size > this.maxBytes()) throw new FileError('limit_exceeded', 'file exceeds the configured transfer limit');
    const handle = await fsp.open(filePath, 'r');
    const row: TransferRow = {
      id: randomId(12),
      deviceId,
      direction: 'download',
      name: path.basename(filePath),
      size: st.size,
      transferred: 0,
      status: 'active',
      startedAt: Date.now(),
      finishedAt: null
    };
    this.active.set(row.id, { row, handle, filePath, nextIndex: 0, touched: Date.now() });
    this.store.upsertTransfer(row);
    return {
      transferId: row.id,
      name: row.name,
      size: row.size,
      chunkSize: FILE_CHUNK_BYTES,
      chunks: Math.max(1, Math.ceil(row.size / FILE_CHUNK_BYTES))
    };
  }

  async downloadChunk(deviceId: string, transferId: string, index: number) {
    const t = this.get(deviceId, transferId);
    if (t.row.direction !== 'download') throw new FileError('bad_request', 'not a download');
    if (t.row.status === 'paused') throw new FileError('bad_request', 'transfer is paused');
    const offset = index * FILE_CHUNK_BYTES;
    if (offset > t.row.size || (offset === t.row.size && t.row.size > 0)) throw new FileError('bad_request', 'chunk out of range');
    const len = Math.min(FILE_CHUNK_BYTES, t.row.size - offset);
    const buf = Buffer.alloc(len);
    if (len > 0) await t.handle.read(buf, 0, len, offset);
    t.row.transferred = Math.max(t.row.transferred, offset + len);
    const last = offset + len >= t.row.size;
    if (last) await this.complete(t);
    return { index, data: buf.toString('base64'), last };
  }

  async uploadStart(deviceId: string, rootId: string, dir: string, name: string, size: number) {
    this.checkCapacity(deviceId);
    const root = this.root(rootId);
    if (!root.writable) throw new FileError('forbidden', 'this shared folder is read-only');
    if (size > this.maxBytes()) throw new FileError('limit_exceeded', 'file exceeds the configured transfer limit');
    const safeName = validateFileName(name);
    const targetDir = await resolveInside(root.path, dir, true);
    if (!(await fsp.stat(targetDir)).isDirectory()) throw new FileError('bad_request', 'target is not a folder');
    const id = randomId(12);
    const partPath = path.join(targetDir, `.${id}.fristy-part`);
    const handle = await fsp.open(partPath, 'wx');
    const row: TransferRow = {
      id,
      deviceId,
      direction: 'upload',
      name: safeName,
      size,
      transferred: 0,
      status: 'active',
      startedAt: Date.now(),
      finishedAt: null
    };
    this.active.set(id, { row, handle, filePath: partPath, finalPath: path.join(targetDir, safeName), nextIndex: 0, touched: Date.now() });
    this.store.upsertTransfer(row);
    return { transferId: id, chunkSize: FILE_CHUNK_BYTES };
  }

  async uploadChunk(deviceId: string, transferId: string, index: number, data: string) {
    const t = this.get(deviceId, transferId);
    if (t.row.direction !== 'upload') throw new FileError('bad_request', 'not an upload');
    if (t.row.status === 'paused') throw new FileError('bad_request', 'transfer is paused');
    if (index !== t.nextIndex) throw new FileError('bad_request', `expected chunk ${t.nextIndex}`);
    const buf = Buffer.from(data, 'base64');
    if (buf.length > FILE_CHUNK_BYTES) throw new FileError('bad_request', 'chunk too large');
    if (t.row.transferred + buf.length > t.row.size) throw new FileError('limit_exceeded', 'more data than declared');
    await t.handle.write(buf, 0, buf.length, t.row.transferred);
    t.row.transferred += buf.length;
    t.nextIndex++;
    return { received: t.row.transferred };
  }

  async finish(deviceId: string, transferId: string) {
    const t = this.get(deviceId, transferId);
    if (t.row.direction !== 'upload') throw new FileError('bad_request', 'not an upload');
    if (t.row.transferred !== t.row.size) throw new FileError('bad_request', 'upload incomplete');
    await t.handle.close();
    const final = uniquePath(t.finalPath!);
    await fsp.rename(t.filePath, final);
    t.row.status = 'completed';
    t.row.finishedAt = Date.now();
    this.active.delete(transferId);
    this.store.upsertTransfer(t.row);
    this.onComplete(t.row);
    return { ok: true as const, path: path.basename(final) };
  }

  pause(deviceId: string, transferId: string, paused: boolean) {
    const t = this.get(deviceId, transferId);
    t.row.status = paused ? 'paused' : 'active';
    this.store.upsertTransfer(t.row);
    return { ok: true as const };
  }

  async cancel(deviceId: string, transferId: string) {
    this.get(deviceId, transferId);
    await this.abort(transferId, 'cancelled');
    return { ok: true as const };
  }

  /** Cancels every transfer of a device (on disconnect/revoke). */
  async cancelDevice(deviceId: string) {
    for (const [id, t] of this.active) if (t.row.deviceId === deviceId) await this.abort(id, 'cancelled');
  }

  history(deviceId: string): TransferRecord[] {
    return this.store.listTransfers(deviceId).map(({ deviceId: _d, ...r }) => r);
  }

  private async complete(t: ActiveTransfer) {
    await t.handle.close().catch(() => undefined);
    t.row.status = 'completed';
    t.row.finishedAt = Date.now();
    this.active.delete(t.row.id);
    this.store.upsertTransfer(t.row);
    this.onComplete(t.row);
  }

  private async abort(id: string, status: 'cancelled' | 'failed') {
    const t = this.active.get(id);
    if (!t) return;
    this.active.delete(id);
    await t.handle.close().catch(() => undefined);
    if (t.row.direction === 'upload') await fsp.unlink(t.filePath).catch(() => undefined);
    t.row.status = status;
    t.row.finishedAt = Date.now();
    this.store.upsertTransfer(t.row);
  }

  private async sweep() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, t] of this.active) if (t.touched < cutoff) await this.abort(id, 'failed');
  }
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
  throw new FileError('bad_request', 'too many files with this name');
}
