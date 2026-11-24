import { describe, expect, it } from 'vitest';
import {
  FailureLockout,
  RateLimiter,
  broadcastAddress,
  buildMagicPacket,
  formatBytes,
  formatPercent,
  formatTemp,
  normalizeMac,
  translate
} from '../src';

describe('RateLimiter', () => {
  it('allows bursts up to capacity then refills', () => {
    let now = 0;
    const rl = new RateLimiter(3, 1, () => now);
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false]);
    expect(rl.take('b')).toBe(true);
    now += 1000;
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
  });
});

describe('FailureLockout', () => {
  it('locks after max failures within the window', () => {
    let now = 0;
    const lk = new FailureLockout(2, 1000, () => now);
    lk.fail('ip');
    expect(lk.isLocked('ip')).toBe(false);
    lk.fail('ip');
    expect(lk.isLocked('ip')).toBe(true);
    now = 1500;
    expect(lk.isLocked('ip')).toBe(false);
  });
});

describe('Wake-on-LAN', () => {
  it('normalizes MACs', () => {
    expect(normalizeMac('aa-bb-cc-dd-ee-ff')).toBe('AA:BB:CC:DD:EE:FF');
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull();
    expect(normalizeMac('xyz')).toBeNull();
  });
  it('builds a 102-byte magic packet', () => {
    const p = buildMagicPacket('01:02:03:04:05:06');
    expect(p.length).toBe(102);
    expect(Array.from(p.slice(0, 6))).toEqual([255, 255, 255, 255, 255, 255]);
    expect(Array.from(p.slice(96, 102))).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('computes broadcast addresses', () => {
    expect(broadcastAddress('192.168.1.23', '255.255.255.0')).toBe('192.168.1.255');
    expect(broadcastAddress('10.0.5.1', '255.255.0.0')).toBe('10.0.255.255');
    expect(broadcastAddress('bad', '255.0.0.0')).toBeNull();
  });
});

describe('formatting', () => {
  it('shows N/A for missing readings instead of fake values', () => {
    expect(formatTemp(null)).toBe('N/A');
    expect(formatPercent(undefined)).toBe('N/A');
    expect(formatBytes(null)).toBe('N/A');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('i18n', () => {
  it('translates with variables and falls back to English', () => {
    expect(translate('en', 'pair.expiresIn', { s: 30 })).toBe('Expires in 30s');
    expect(translate('he', 'nav.games')).toBe('משחקים');
  });
});
