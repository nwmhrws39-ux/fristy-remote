import { handle, sha256Hex, type Db } from './api';

interface Env {
  DB: D1Database;
  /** set with: wrangler secret put ADMIN_CODE */
  ADMIN_CODE: string;
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // The caller's IP is only used, hashed, as a rate-limit key – it is never stored or shown.
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? null;
    try {
      return await handle(req, {
        db: d1(env.DB),
        adminCode: env.ADMIN_CODE ?? '',
        now: () => Date.now(),
        country: country && /^[A-Z]{2}$/.test(country) ? country : null,
        clientKey: (await sha256Hex(`fristy:${ip}`)).slice(0, 32)
      });
    } catch {
      return new Response(JSON.stringify({ error: 'internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
};
