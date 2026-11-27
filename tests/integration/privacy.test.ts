import { afterEach, describe, expect, it } from 'vitest';
import { FristyCore } from '../../apps/desktop/src/core';
import { fakePlatform, freePort, pairDevice } from '../../apps/desktop/test/helpers';
import { generateKeyPair, LEGAL_VERSION } from '@fristy/shared';

const cores: FristyCore[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.stop();
});

async function core() {
  const c = await FristyCore.create({ dataDir: null, platform: fakePlatform(), identity: generateKeyPair(), identityPersisted: true, appVersion: '0.1.0', computerName: 'PRIV-PC', discovery: false });
  c.settings.update({ port: await freePort() });
  await c.start();
  cores.push(c);
  return c;
}

describe('privacy controls on the PC', () => {
  it('records acceptance with version and timestamp, and refuses without the 18+ statement', async () => {
    const c = await core();
    expect(() => c.acceptLegal({ adult: false, accepted: true })).toThrow(/18 or older/);
    expect(() => c.acceptLegal({ adult: true, accepted: false })).toThrow();
    const a = c.acceptLegal({ adult: true, accepted: true, optional: { screen: true } });
    expect(a).toMatchObject({ version: LEGAL_VERSION, adult: true, documents: ['terms', 'eula', 'acceptable-use'] });
    expect(c.settings.get()).toMatchObject({ screenEnabled: true, inputEnabled: false, relayEnabled: false });
    expect(c.state().legal.accepted?.acceptedAt).toBeGreaterThan(Date.now() - 5000);
  });

  it('exports everything stored locally without keys or secrets', async () => {
    const c = await core();
    await pairDevice(c, ['monitor']);
    const data = c.exportLocalData() as { devices: Record<string, unknown>[]; logs: unknown[] };
    expect(data.devices).toHaveLength(1);
    expect(data.devices[0]).not.toHaveProperty('publicKey');
    expect(JSON.stringify(data)).not.toMatch(/secretKey|privateKey/);
    expect(data.logs.length).toBeGreaterThan(0);
  });

  it('applies the history retention period and deletes history on request', async () => {
    const c = await core();
    await pairDevice(c, ['monitor']);
    const db = (c.store as unknown as { db: { run(sql: string, p?: unknown[]): void } }).db;
    db.run('UPDATE logs SET ts = ?', [Date.now() - 200 * 86_400_000]);
    c.store.log('info', 'test', 'recent entry');
    c.settings.update({ historyRetentionDays: 90 });
    c.applyRetention();
    expect(c.store.listLogs(100).map((l) => l.message)).toEqual(['recent entry']);
    c.deleteHistory();
    expect(c.store.listLogs(100).every((l) => /History deleted/.test(l.message))).toBe(true);
  });

  it('emergency revoke removes every device; withdraw clears acceptance', async () => {
    const c = await core();
    await pairDevice(c, ['monitor']);
    c.acceptLegal({ adult: true, accepted: true });
    expect(c.revokeAllDevices()).toBe(1);
    expect(c.store.listDevices()).toEqual([]);
    c.withdrawAndReset();
    expect(c.state().legal.accepted).toBeNull();
  });
});
