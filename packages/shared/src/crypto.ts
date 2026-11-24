import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {
  ClientHelloSchema,
  EncryptedFrameSchema,
  PROTOCOL_VERSION,
  ServerHelloSchema,
  type ClientHello,
  type ServerHello
} from '@fristy/protocol';

/*
 * FRISTY secure channel
 * ---------------------
 * A small Noise-style handshake built from NaCl primitives (X25519 + SHA-512 +
 * XSalsa20-Poly1305). It gives:
 *   - mutual authentication: the client must hold the private key of its
 *     registered identity, the server must hold the private key the client
 *     pinned from the QR code.
 *   - forward secrecy: both sides contribute fresh ephemeral keys.
 *   - integrity + replay protection: strictly increasing per-direction nonces;
 *     any replayed, reordered or tampered frame fails to decrypt and the
 *     connection is dropped.
 * The same code runs in Node (desktop, relay tests) and React Native (mobile),
 * so the relay server only ever forwards ciphertext.
 */

export const { encodeBase64, decodeBase64 } = naclUtil;

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  const kp = nacl.box.keyPair.fromSecretKey(secretKey);
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

export function randomId(bytes = 16): string {
  return Array.from(nacl.randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two byte arrays. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nacl.verify(a, b);
}

export function constantTimeEqualString(a: string, b: string): boolean {
  // Hash both sides so the comparison is fixed-length and does not leak a prefix match.
  const ha = nacl.hash(new TextEncoder().encode(a));
  const hb = nacl.hash(new TextEncoder().encode(b));
  return nacl.verify(ha, hb);
}

/** Short, human-friendly fingerprint for a public key (shown in UIs). */
export function fingerprint(publicKey: Uint8Array): string {
  const h = nacl.hash(publicKey);
  const hex = Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

const LABEL = new TextEncoder().encode('FRISTY-REMOTE-v1');

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function dh(secret: Uint8Array, pub: Uint8Array): Uint8Array {
  const shared = nacl.scalarMult(secret, pub);
  // Reject low-order points (all-zero shared secret).
  if (shared.every((b) => b === 0)) throw new HandshakeError('invalid public key');
  return shared;
}

export class HandshakeError extends Error {}

export interface SessionKeys {
  /** key for client → server frames */
  c2s: Uint8Array;
  /** key for server → client frames */
  s2c: Uint8Array;
  /** 6-digit short authentication string (for manual-code pairing verification) */
  sas: string;
}

function deriveKeys(
  cs: Uint8Array,
  ss: Uint8Array,
  ce: Uint8Array,
  se: Uint8Array,
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array
): SessionKeys {
  const okm = nacl.hash(concat(LABEL, cs, ss, ce, se, dh1, dh2, dh3));
  const sasHash = nacl.hash(concat(okm, new TextEncoder().encode('sas')));
  const sasNum = ((sasHash[0]! << 24) | (sasHash[1]! << 16) | (sasHash[2]! << 8) | sasHash[3]!) >>> 0;
  return {
    c2s: okm.slice(0, 32),
    s2c: okm.slice(32, 64),
    sas: String(sasNum % 1_000_000).padStart(6, '0')
  };
}

/* ------------------------------------------------------------------ */
/* Cipher state                                                         */
/* ------------------------------------------------------------------ */

function counterNonce(counter: number): Uint8Array {
  const n = new Uint8Array(nacl.secretbox.nonceLength);
  let c = counter;
  for (let i = n.length - 1; i >= n.length - 8 && c > 0; i--) {
    n[i] = c % 256;
    c = Math.floor(c / 256);
  }
  return n;
}

export class DecryptError extends Error {}

/** Encrypts outbound JSON messages and decrypts inbound frames, enforcing nonce order. */
export class SecureSession {
  private sendCounter = 0;
  private recvCounter = 0;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
    readonly sas: string,
    readonly peerStatic: Uint8Array
  ) {}

  /** Returns a serialized `{t:'e', c}` frame. */
  seal(message: unknown): string {
    const plaintext = naclUtil.decodeUTF8(JSON.stringify(message));
    const box = nacl.secretbox(plaintext, counterNonce(this.sendCounter++), this.sendKey);
    return JSON.stringify({ t: 'e', c: encodeBase64(box) });
  }

  /** Parses and decrypts a frame. Throws DecryptError on any failure (caller must close). */
  open(frame: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      throw new DecryptError('malformed frame');
    }
    const f = EncryptedFrameSchema.safeParse(parsed);
    if (!f.success) throw new DecryptError('unexpected frame');
    let box: Uint8Array;
    try {
      box = decodeBase64(f.data.c);
    } catch {
      throw new DecryptError('bad encoding');
    }
    const plain = nacl.secretbox.open(box, counterNonce(this.recvCounter), this.recvKey);
    if (!plain) throw new DecryptError('authentication failed (tampered, replayed or wrong key)');
    this.recvCounter++;
    try {
      return JSON.parse(naclUtil.encodeUTF8(plain));
    } catch {
      throw new DecryptError('invalid payload');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Handshake                                                            */
/* ------------------------------------------------------------------ */

/** Client side. `serverStatic` is the pinned public key from the QR code / stored pairing. */
export function clientHandshake(identity: KeyPair, serverStatic: Uint8Array) {
  const eph = generateKeyPair();
  const hello: ClientHello = {
    t: 'hello',
    v: PROTOCOL_VERSION,
    cs: encodeBase64(identity.publicKey),
    ce: encodeBase64(eph.publicKey)
  };
  return {
    hello: JSON.stringify(hello),
    finish(serverHelloRaw: string): SecureSession {
      let obj: unknown;
      try {
        obj = JSON.parse(serverHelloRaw);
      } catch {
        throw new HandshakeError('malformed server hello');
      }
      const parsed = ServerHelloSchema.safeParse(obj);
      if (!parsed.success) throw new HandshakeError('invalid server hello');
      if (parsed.data.v !== PROTOCOL_VERSION) throw new HandshakeError('protocol version mismatch');
      const ss = decodeBase64(parsed.data.ss);
      if (!constantTimeEqual(ss, serverStatic)) {
        throw new HandshakeError('server identity does not match the paired computer');
      }
      const se = decodeBase64(parsed.data.se);
      const keys = deriveKeys(
        identity.publicKey,
        serverStatic,
        eph.publicKey,
        se,
        dh(eph.secretKey, se),
        dh(identity.secretKey, se),
        dh(eph.secretKey, serverStatic)
      );
      return new SecureSession(keys.c2s, keys.s2c, keys.sas, serverStatic);
    }
  };
}

/** Server side: processes the client's hello and returns the reply + session. */
export function serverHandshake(identity: KeyPair, clientHelloRaw: string): { reply: string; session: SecureSession; clientStatic: Uint8Array } {
  let obj: unknown;
  try {
    obj = JSON.parse(clientHelloRaw);
  } catch {
    throw new HandshakeError('malformed client hello');
  }
  const parsed = ClientHelloSchema.safeParse(obj);
  if (!parsed.success) throw new HandshakeError('invalid client hello');
  if (parsed.data.v !== PROTOCOL_VERSION) throw new HandshakeError('protocol version mismatch');
  const cs = decodeBase64(parsed.data.cs);
  const ce = decodeBase64(parsed.data.ce);
  const eph = generateKeyPair();
  const keys = deriveKeys(
    cs,
    identity.publicKey,
    ce,
    eph.publicKey,
    dh(eph.secretKey, ce),
    dh(eph.secretKey, cs),
    dh(identity.secretKey, ce)
  );
  const reply: ServerHello = {
    t: 'hello',
    v: PROTOCOL_VERSION,
    ss: encodeBase64(identity.publicKey),
    se: encodeBase64(eph.publicKey)
  };
  return { reply: JSON.stringify(reply), session: new SecureSession(keys.s2c, keys.c2s, keys.sas, cs), clientStatic: cs };
}

/* ------------------------------------------------------------------ */
/* Relay ownership proof                                                */
/* ------------------------------------------------------------------ */

/** Relay → host: encrypt a random challenge to the host's public key. */
export function makeRelayChallenge(hostPublic: Uint8Array) {
  const challenge = randomBytes(32);
  const relayEph = generateKeyPair();
  const nonce = randomBytes(nacl.box.nonceLength);
  const c = nacl.box(challenge, nonce, hostPublic, relayEph.secretKey);
  return {
    challenge,
    frame: { t: 'challenge' as const, rpk: encodeBase64(relayEph.publicKey), n: encodeBase64(nonce), c: encodeBase64(c) }
  };
}

/** Host: answer the relay challenge, proving possession of the identity secret key. */
export function answerRelayChallenge(identity: KeyPair, frame: { rpk: string; n: string; c: string }): string | null {
  const opened = nacl.box.open(decodeBase64(frame.c), decodeBase64(frame.n), decodeBase64(frame.rpk), identity.secretKey);
  return opened ? encodeBase64(opened) : null;
}
