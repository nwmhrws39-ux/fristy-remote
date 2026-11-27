import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS, LEGAL_VERSION, legalUrl } from '@fristy/shared';
import { handle, type Db } from '../src/api';

function deps() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const db: Db = {
    first: async (q, ...p) => (sql.prepare(q).get(...p) as never) ?? null,
    all: async (q, ...p) => sql.prepare(q).all(...p) as never[],
    run: async (q, ...p) => {
      sql.prepare(q).run(...p);
    }
  };
  return { db, adminCode: 'x', now: () => Date.now(), country: 'IL', clientKey: 'k' };
}
const get = (p: string) => handle(new Request(`https://x${p}`), deps());

describe('legal website', () => {
  const ROUTES = ['/privacy', '/terms', '/eula', '/acceptable-use', '/security', '/location-privacy', '/cookies', '/refunds', '/licenses', '/delete-account', '/report-abuse', '/contact', '/accessibility'];

  it('serves every required page in English and Hebrew (RTL), with no cookies or scripts', async () => {
    for (const r of ROUTES) {
      for (const lang of ['', '?lang=he']) {
        const res = await get(r + lang);
        expect(res.status, r + lang).toBe(200);
        const body = await res.text();
        expect(body).toContain(lang ? 'dir="rtl"' : 'dir="ltr"');
        expect(body).not.toMatch(/<script/i);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      }
    }
  });

  it('shows version and effective date, and marks documents as drafts', async () => {
    const body = await (await get('/privacy')).text();
    expect(body).toContain(`Version ${LEGAL_VERSION}`);
    expect(body).toMatch(/DRAFT/);
    const he = await (await get('/privacy?lang=he')).text();
    expect(he).toContain('מדיניות פרטיות');
  });

  it('the apps link to pages that exist', async () => {
    for (const d of LEGAL_DOCS) {
      const u = new URL(legalUrl(d.id, 'he', 'https://x'));
      expect((await get(u.pathname + u.search)).status, d.id).toBe(200);
    }
  });

  it('the JSON root and API are unaffected', async () => {
    expect(await (await get('/')).json()).toMatchObject({ ok: true });
    expect((await get('/nope')).status).toBe(404);
  });

  it('accepts reports from the HTML form', async () => {
    const d = deps();
    const post = (body: string) => handle(new Request('https://x/report-abuse?lang=he', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), d);
    expect((await post('category=other&message=hi')).status).toBe(400);
    const ok = await post(new URLSearchParams({ category: 'unauthorized-tracking', message: 'someone tracks me', contact: '' }).toString());
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('הדיווח נשלח');
    expect(await d.db.all('SELECT category FROM abuse_reports')).toEqual([{ category: 'unauthorized-tracking' }]);
  });

  it('the generated pages are up to date with /legal and the document list matches the apps', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const file = path.join(root, 'apps', 'admin-server', 'src', 'legal-pages.ts');
    const before = fs.readFileSync(file, 'utf8');
    execFileSync('node', [path.join(root, 'scripts', 'build-legal-site.mjs')]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    const script = fs.readFileSync(path.join(root, 'scripts', 'build-legal-site.mjs'), 'utf8');
    for (const d of LEGAL_DOCS) expect(script).toContain(`['${d.id}', '${d.file}']`);
  });

  it('the contract documents carry the version the apps ask users to accept', () => {
    const root = path.join(__dirname, '..', '..', '..', 'legal');
    for (const f of ['TERMS_OF_SERVICE.md', 'PRIVACY_POLICY.md', 'END_USER_LICENSE_AGREEMENT.md', 'ACCEPTABLE_USE_POLICY.md']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8'), f).toContain(`version: ${LEGAL_VERSION}`);
    }
  });
});
