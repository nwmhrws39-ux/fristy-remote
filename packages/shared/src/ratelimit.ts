/** Token bucket rate limiter keyed by an arbitrary string (IP, device id ...). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now
  ) {}

  take(key: string, cost = 1): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.updated) / 1000) * this.refillPerSec);
    b.updated = t;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune();
    return ok;
  }

  private prune() {
    const t = this.now();
    for (const [k, b] of this.buckets) {
      if (t - b.updated > 10 * 60_000) this.buckets.delete(k);
    }
  }
}

/** Counts failures in a sliding window and locks a key out after `max` failures. */
export class FailureLockout {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  isLocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const t = this.now();
    return (this.failures.get(key) ?? []).filter((x) => t - x < this.windowMs);
  }
}
