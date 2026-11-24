import { PAIRING_MAX_ATTEMPTS, PAIRING_TTL_MS } from '@fristy/protocol';
import { constantTimeEqualString, encodeBase64, randomBytes, randomId } from '@fristy/shared';

/** Unambiguous alphabet (no 0/O/1/I). 8 chars ≈ 40 bits. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PairingSession {
  pairingId: string;
  secret: string; // base64, 32 bytes – encoded in the QR code
  code: string; // 8 chars, for manual entry
  expiresAt: number;
  attempts: number;
}

export type PairingCheck = { ok: true } | { ok: false; reason: 'pairing_expired' | 'pairing_invalid' };

function generateCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * One active pairing session at a time. A session is single-use: it is
 * consumed after a successful verification, invalidated after too many wrong
 * attempts, and expires after PAIRING_TTL_MS.
 */
export class PairingManager {
  private active: PairingSession | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = PAIRING_TTL_MS
  ) {}

  create(): PairingSession {
    this.active = {
      pairingId: randomId(12),
      secret: encodeBase64(randomBytes(32)),
      code: generateCode(),
      expiresAt: this.now() + this.ttlMs,
      attempts: 0
    };
    return { ...this.active };
  }

  current(): PairingSession | null {
    if (this.active && this.now() > this.active.expiresAt) this.active = null;
    return this.active ? { ...this.active } : null;
  }

  cancel(): void {
    this.active = null;
  }

  /** Verifies a secret (QR) or code (manual). Consumes the session on success. */
  verify(pairingId: string, proof: { secret?: string; code?: string }): PairingCheck {
    const s = this.active;
    if (!s || !constantTimeEqualString(pairingId, s.pairingId)) return { ok: false, reason: 'pairing_invalid' };
    if (this.now() > s.expiresAt) {
      this.active = null;
      return { ok: false, reason: 'pairing_expired' };
    }
    const ok = proof.secret
      ? constantTimeEqualString(proof.secret, s.secret)
      : proof.code
        ? constantTimeEqualString(proof.code.replace(/-/g, '').toUpperCase(), s.code)
        : false;
    if (!ok) {
      s.attempts++;
      if (s.attempts >= PAIRING_MAX_ATTEMPTS) this.active = null;
      return { ok: false, reason: 'pairing_invalid' };
    }
    this.active = null; // single use
    return { ok: true };
  }
}
