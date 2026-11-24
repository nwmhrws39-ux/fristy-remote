import { z } from 'zod';

/*
 * Optional integration with FRISTY Launcher through its documented local API
 * (see docs/INTEGRATIONS.md). Requests only go to loopback addresses and carry
 * a bearer token the user copies from FRISTY Launcher's settings; the token is
 * stored with OS-level encryption by the Electron main process.
 * FRISTY Remote works fully without this integration.
 */

const GameSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,96}$/),
  name: z.string().min(1).max(128),
  artworkUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'))
    .nullable()
    .optional(),
  installDir: z.string().max(512).nullable().optional()
});
const ListSchema = z.object({ games: z.array(GameSchema).max(5000) });
const HealthSchema = z.object({ app: z.string(), version: z.string(), api: z.number().int() });

export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

export class FristyLauncherClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!isLoopbackUrl(baseUrl)) throw new Error('FRISTY Launcher API must be on localhost');
  }

  private async request(pathname: string, init?: RequestInit): Promise<unknown> {
    const token = this.token();
    if (!token) throw new Error('FRISTY Launcher API token is not configured');
    const res = await this.fetchImpl(new URL(pathname, this.baseUrl), {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`FRISTY Launcher API error ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  async health() {
    return HealthSchema.parse(await this.request('/v1/health'));
  }

  async listGames() {
    return ListSchema.parse(await this.request('/v1/games')).games.map((g) => ({
      id: g.id,
      name: g.name,
      artworkUrl: g.artworkUrl ?? null,
      installDir: g.installDir ?? null
    }));
  }

  async launch(id: string) {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(id)) throw new Error('invalid game id');
    await this.request(`/v1/games/${encodeURIComponent(id)}/launch`, { method: 'POST', body: '{}' });
  }
}
