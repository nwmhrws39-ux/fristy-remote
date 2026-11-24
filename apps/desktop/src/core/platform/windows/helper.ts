import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { PlatformError } from '../types';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * Manages the long-running PowerShell helper (resources/fristy-helper.ps1).
 * Requests are serialized as JSON lines. The helper is restarted on crash.
 */
export class NativeHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stopped = false;

  constructor(private readonly scriptPath: string) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this.proc = proc;
      let isReady = false;
      const timer = setTimeout(() => reject(new PlatformError('failed', 'native helper did not start')), 30_000);
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        let msg: { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string };
        try {
          msg = JSON.parse(line.replace(/^﻿/, ''));
        } catch {
          return;
        }
        if (msg.ready && !isReady) {
          isReady = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (typeof msg.id !== 'number') return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new PlatformError('failed', msg.error ?? 'native operation failed'));
      });
      proc.stderr.on('data', () => undefined);
      proc.on('exit', () => {
        clearTimeout(timer);
        if (!isReady) reject(new PlatformError('failed', 'native helper exited during startup'));
        this.proc = null;
        this.ready = null;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new PlatformError('failed', 'native helper exited'));
        }
        this.pending.clear();
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(new PlatformError('failed', `cannot start native helper: ${e.message}`));
      });
    });
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  async call<T = unknown>(op: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (this.stopped) throw new PlatformError('failed', 'helper stopped');
    await this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PlatformError('failed', `${op} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.proc!.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
  }
}
