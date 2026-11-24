import { z } from 'zod';
import { PermissionSchema } from './permissions';

/** 32-byte key, base64 encoded (44 chars with padding). */
export const Key32Schema = z
  .string()
  .length(44)
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'invalid base64 key');

/* ---------------- Plaintext handshake frames ---------------- */

export const ClientHelloSchema = z.object({
  t: z.literal('hello'),
  v: z.number().int().positive(),
  /** client static public key (identity) */
  cs: Key32Schema,
  /** client ephemeral public key */
  ce: Key32Schema
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const ServerHelloSchema = z.object({
  t: z.literal('hello'),
  v: z.number().int().positive(),
  /** server static public key (identity, pinned by the client) */
  ss: Key32Schema,
  /** server ephemeral public key */
  se: Key32Schema
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

/** Every frame after the handshake: authenticated ciphertext (base64). */
export const EncryptedFrameSchema = z.object({
  t: z.literal('e'),
  c: z.string().min(1).max(1_000_000)
});
export type EncryptedFrame = z.infer<typeof EncryptedFrameSchema>;

export const PlainErrorFrameSchema = z.object({
  t: z.literal('err'),
  code: z.string().max(64),
  message: z.string().max(512)
});

/* ---------------- Session establishment (inside encryption) ---------------- */

export const PlatformSchema = z.enum(['android', 'ios', 'web', 'other']);

export const PairRequestSchema = z
  .object({
    kind: z.literal('pair'),
    /** one-time secret from the QR code (base64, 32 bytes) */
    secret: Key32Schema.optional(),
    /** manual pairing code, e.g. "K7Q2-9MXA" */
    code: z
      .string()
      .regex(/^[A-Z2-9]{4}-?[A-Z2-9]{4}$/)
      .optional(),
    pairingId: z.string().min(8).max(64),
    deviceName: z.string().min(1).max(64),
    platform: PlatformSchema
  })
  .refine((v) => Boolean(v.secret) !== Boolean(v.code), {
    message: 'exactly one of secret or code is required'
  });
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const AuthRequestSchema = z.object({
  kind: z.literal('auth'),
  deviceName: z.string().min(1).max(64).optional()
});
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

export const SessionOpenSchema = z.union([PairRequestSchema, AuthRequestSchema]);

export const HostInfoSchema = z.object({
  hostId: z.string(),
  computerName: z.string(),
  appVersion: z.string(),
  protocolVersion: z.number().int(),
  inputEnabled: z.boolean()
});
export type HostInfo = z.infer<typeof HostInfoSchema>;

export const SessionAcceptedSchema = z.object({
  kind: z.literal('accepted'),
  deviceId: z.string(),
  permissions: z.array(PermissionSchema),
  host: HostInfoSchema,
  /** true when this session was created by a fresh pairing */
  paired: z.boolean()
});
export type SessionAccepted = z.infer<typeof SessionAcceptedSchema>;

/** Sent while the PC owner has not yet approved a pairing request. */
export const PairPendingSchema = z.object({
  kind: z.literal('pair_pending'),
  /** short authentication string both screens display */
  sas: z.string().regex(/^\d{6}$/)
});

export const SessionRejectedSchema = z.object({
  kind: z.literal('rejected'),
  code: z.enum([
    'unknown_device',
    'revoked',
    'pairing_expired',
    'pairing_invalid',
    'pairing_denied',
    'rate_limited',
    'remote_disabled',
    'protocol'
  ]),
  message: z.string().max(256)
});
export type SessionRejected = z.infer<typeof SessionRejectedSchema>;

/* ---------------- QR / discovery payloads ---------------- */

/** Content of the pairing QR code (JSON, prefixed with "fristy:"). */
export const PairingQrSchema = z.object({
  v: z.literal(1),
  /** desktop static public key */
  pk: Key32Schema,
  pid: z.string().min(8).max(64),
  secret: Key32Schema,
  /** LAN addresses the desktop is reachable at */
  hosts: z.array(z.string().max(64)).min(1).max(8),
  port: z.number().int().min(1).max(65535),
  name: z.string().max(64),
  exp: z.number().int()
});
export type PairingQr = z.infer<typeof PairingQrSchema>;

export const QR_PREFIX = 'fristy:';

export function encodePairingQr(qr: PairingQr): string {
  return QR_PREFIX + JSON.stringify(qr);
}

export function decodePairingQr(text: string): PairingQr | null {
  if (!text.startsWith(QR_PREFIX)) return null;
  try {
    const parsed = PairingQrSchema.safeParse(JSON.parse(text.slice(QR_PREFIX.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const DiscoveryBeaconSchema = z.object({
  type: z.literal('fristy.beacon'),
  v: z.number().int(),
  name: z.string().max(64),
  pk: Key32Schema,
  port: z.number().int().min(1).max(65535),
  /** true while a manual pairing code is active */
  pairing: z.boolean(),
  pid: z.string().max(64).optional()
});
export type DiscoveryBeacon = z.infer<typeof DiscoveryBeaconSchema>;
