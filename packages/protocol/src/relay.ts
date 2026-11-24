import { z } from 'zod';
import { Key32Schema } from './handshake';

/**
 * Relay protocol. The relay is a *blind* forwarder: it never sees plaintext.
 * All control traffic is end-to-end encrypted between phone and PC using the
 * same handshake as LAN mode; the relay only moves opaque strings.
 *
 * Host (PC) flow:   {t:'host', pk} → {t:'challenge', rpk, n, c} → {t:'prove', r} → {t:'registered'}
 * Client flow:      {t:'client', host} → {t:'ready'} | {t:'offline'}
 * Data (host side): {t:'open', ch} / {t:'data', ch, d} / {t:'close', ch}
 * Data (client):    raw strings after 'ready'
 */

export const RelayHostHelloSchema = z.object({ t: z.literal('host'), pk: Key32Schema });
export const RelayProveSchema = z.object({ t: z.literal('prove'), r: Key32Schema });
export const RelayClientHelloSchema = z.object({ t: z.literal('client'), host: Key32Schema });

export const RelayChallengeSchema = z.object({
  t: z.literal('challenge'),
  rpk: Key32Schema,
  n: z.string().max(64),
  c: z.string().max(256)
});

export const RelayHostDataSchema = z.object({
  t: z.literal('data'),
  ch: z.number().int().nonnegative(),
  d: z.string().max(1_000_000)
});
export const RelayHostCloseSchema = z.object({ t: z.literal('close'), ch: z.number().int().nonnegative() });
export const RelayOpenSchema = z.object({ t: z.literal('open'), ch: z.number().int().nonnegative() });

export const RelayHostInboundSchema = z.union([RelayHostDataSchema, RelayHostCloseSchema]);
export const RelayToHostSchema = z.union([
  RelayChallengeSchema,
  z.object({ t: z.literal('registered') }),
  RelayOpenSchema,
  RelayHostDataSchema,
  RelayHostCloseSchema,
  z.object({ t: z.literal('error'), message: z.string() })
]);

export const RelayToClientControlSchema = z.union([
  z.object({ t: z.literal('ready') }),
  z.object({ t: z.literal('offline') }),
  z.object({ t: z.literal('error'), message: z.string() })
]);
