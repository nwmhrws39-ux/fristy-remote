import { handle, sha256Hex, type Db } from './api';
import { SCHEMA_SQL, schemaStatements } from './schema';

export { LiveHub } from './hub';

interface Env {
  DB: D1Database;
  /** set with: wrangler secret put ADMIN_CODE */
  ADMIN_CODE: string;
  /** live updates (optional: without it apps fall back to periodic check-ins) */
  HUB?: DurableObjectNamespace;
}

function d1(db: D1Database): Db {
  return {
    first: (sql, ...p) => db.prepare(sql).bind(...p).first(),
    all: async (sql, ...p) => (await db.prepare(sql).bind(...p).all()).results as never[],
    run: async (sql, ...p) => {
      await db.prepare(sql).bind(...p).run();
    }
  };
}

// Databases created by an older version get the new tables on first use.
let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch(schemaStatements(SCHEMA_SQL).map((s) => db.prepare(s)));
  schemaReady = true;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The caller's IP is only used, hashed, as a rate-limit key – it is never stored or shown.
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? null;
    const url = new URL(req.url);
    const hub = env.HUB?.get(env.HUB.idFromName('hub'));
    // Live channel: apps hold a WebSocket and get a "refresh" when the owner changes something.
    if (url.pathname === '/v1/live') {
      const installId = url.searchParams.get('installId') ?? '';
      if (!hub) return new Response('live updates not available', { status: 501 });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !/^[A-Za-z0-9-]{16,64}$/.test(installId)) return new Response('bad request', { status: 400 });
      return hub.fetch(`https://hub/connect?installId=${encodeURIComponent(installId)}`, req);
    }
    try {
      await ensureSchema(env.DB);
      return await handle(req, {
        db: d1(env.DB),
        adminCode: env.ADMIN_CODE ?? '',
        now: () => Date.now(),
        country: country && /^[A-Z]{2}$/.test(country) ? country : null,
        clientKey: (await sha256Hex(`fristy:${ip}`)).slice(0, 32),
        // ntfy.sh: free push notifications to the owner's phone (topic chosen in the admin panel)
        notify: (topic, title, message) =>
          ctx.waitUntil(
            fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
              method: 'POST',
              headers: { Title: title, Tags: 'iphone' },
              body: message
            }).catch(() => undefined)
          ),
        changed: (installId) => {
          if (hub)
            ctx.waitUntil(
              hub
                .fetch('https://hub/broadcast', { method: 'POST', body: JSON.stringify(installId ? { target: installId } : {}) })
                .then(() => undefined, () => undefined)
            );
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
};
