import { describe, expect, it } from 'vitest';
import {
  METHODS,
  PairRequestSchema,
  SessionAcceptedSchema,
  decodePairingQr,
  encodePairingQr,
  hasPermission,
  isMethodName,
  validateParams
} from '../src';

const KEY = 'A'.repeat(43) + '=';

describe('method table', () => {
  it('rejects unknown methods', () => {
    expect(isMethodName('shell.exec')).toBe(false);
    expect(isMethodName('__proto__')).toBe(false);
    expect(isMethodName('apps.launch')).toBe(true);
  });

  it('every method except ping requires a permission', () => {
    for (const [name, def] of Object.entries(METHODS)) {
      if (name === 'session.ping') continue;
      expect(def.permission, name).not.toBeNull();
    }
  });

  it('validates params strictly', () => {
    expect(validateParams('apps.launch', { appId: 'chrome' }).ok).toBe(true);
    expect(validateParams('apps.launch', { appId: 'chrome', path: 'C:/evil.exe' }).ok).toBe(false);
    expect(validateParams('apps.launch', {}).ok).toBe(false);
    expect(validateParams('input.mouseMove', { dx: 1e9, dy: 0 }).ok).toBe(false);
    expect(validateParams('audio.setVolume', { level: 101 }).ok).toBe(false);
  });

  it('requires explicit confirmation for destructive power actions', () => {
    expect(validateParams('power.schedule', { action: 'shutdown', delaySec: 60 }).ok).toBe(false);
    expect(validateParams('power.schedule', { action: 'shutdown', delaySec: 60, confirm: true }).ok).toBe(true);
    expect(validateParams('games.close', { gameId: 'x' }).ok).toBe(false);
  });

  it('input.key only accepts known keys', () => {
    expect(validateParams('input.key', { key: 'enter', modifiers: ['ctrl'] }).ok).toBe(true);
    expect(validateParams('input.key', { key: 'rm -rf' }).ok).toBe(false);
  });
});

describe('pairing payloads', () => {
  it('round-trips the QR payload', () => {
    const qr = { v: 1 as const, pk: KEY, pid: 'pairing-123', secret: KEY, hosts: ['192.168.1.10'], port: 47800, name: 'PC', exp: 1 };
    expect(decodePairingQr(encodePairingQr(qr))).toEqual(qr);
    expect(decodePairingQr('fristy:{bad json')).toBeNull();
    expect(decodePairingQr('https://example.com')).toBeNull();
  });

  it('requires exactly one of secret or code', () => {
    const base = { kind: 'pair', pairingId: 'pairing-123', deviceName: 'Phone', platform: 'android' };
    expect(PairRequestSchema.safeParse({ ...base }).success).toBe(false);
    expect(PairRequestSchema.safeParse({ ...base, secret: KEY }).success).toBe(true);
    expect(PairRequestSchema.safeParse({ ...base, code: 'K7Q2-9MXA' }).success).toBe(true);
    expect(PairRequestSchema.safeParse({ ...base, code: 'K7Q2-9MXA', secret: KEY }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('older apps ignore permissions they do not know instead of failing', () => {
    const parsed = SessionAcceptedSchema.safeParse({
      kind: 'accepted',
      deviceId: 'd',
      paired: false,
      permissions: ['monitor', 'teleport', 'screen'],
      host: { hostId: 'h', computerName: 'PC', appVersion: '1', protocolVersion: 1, inputEnabled: false, relayUrl: null, futureField: 1 }
    });
    expect(parsed.success && parsed.data.permissions).toEqual(['monitor', 'screen']);
  });

  it('checks grants', () => {
    expect(hasPermission(['monitor'], 'monitor')).toBe(true);
    expect(hasPermission(['monitor'], 'power')).toBe(false);
    expect(hasPermission([], null)).toBe(true);
  });
});
