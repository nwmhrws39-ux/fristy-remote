import path from 'node:path';
import type { Platform, ProcessInfo } from '../platform/types';

/** Caches the process list briefly so status queries from many devices stay cheap. */
export class ProcessCache {
  private cache: { at: number; list: ProcessInfo[] } | null = null;
  private pending: Promise<ProcessInfo[]> | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly maxAgeMs = 2500
  ) {}

  async list(): Promise<ProcessInfo[]> {
    if (this.cache && Date.now() - this.cache.at < this.maxAgeMs) return this.cache.list;
    if (!this.pending) {
      this.pending = this.platform
        .listProcesses()
        .catch(() => [] as ProcessInfo[])
        .then((list) => {
          this.cache = { at: Date.now(), list };
          return list;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }

  invalidate() {
    this.cache = null;
  }
}

const norm = (p: string) => path.win32.normalize(p).toLowerCase();

export function processesForExecutable(list: ProcessInfo[], exePath: string, processName: string | null): ProcessInfo[] {
  const target = norm(exePath);
  const name = (processName ?? path.win32.basename(exePath, '.exe')).toLowerCase().replace(/\.exe$/, '');
  return list.filter((p) => (p.path ? norm(p.path) === target : false) || p.name.toLowerCase() === name);
}

export function processesInDirectory(list: ProcessInfo[], dir: string): ProcessInfo[] {
  const d = norm(dir).replace(/\\+$/, '') + '\\';
  return list.filter((p) => p.path && norm(p.path).startsWith(d));
}
