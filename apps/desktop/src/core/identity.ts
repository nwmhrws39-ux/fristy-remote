import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, keyPairFromSecret, type KeyPair } from '@fristy/shared';

/** Encrypts/decrypts small secrets with OS-level protection (Electron safeStorage → Windows DPAPI). */
export interface SecretCipher {
  available(): boolean;
  encrypt(plain: Buffer): Buffer;
  decrypt(cipher: Buffer): Buffer;
}

/**
 * Loads or creates the PC's long-term identity key. The private key is stored
 * encrypted with the OS secret store; if OS encryption is unavailable we refuse
 * to persist it in plaintext and generate an ephemeral key instead (devices
 * will then need to re-pair after restart).
 */
export function loadIdentity(dir: string, cipher: SecretCipher): { identity: KeyPair; persisted: boolean } {
  const file = path.join(dir, 'identity.key');
  if (cipher.available() && fs.existsSync(file)) {
    try {
      const secret = cipher.decrypt(fs.readFileSync(file));
      if (secret.length === 32) return { identity: keyPairFromSecret(new Uint8Array(secret)), persisted: true };
    } catch {
      /* unreadable (e.g. profile moved) – fall through and create a new identity */
    }
  }
  const identity = generateKeyPair();
  if (!cipher.available()) return { identity, persisted: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, cipher.encrypt(Buffer.from(identity.secretKey)), { mode: 0o600 });
  return { identity, persisted: true };
}

/** Generic encrypted secret storage on top of the same cipher (e.g. integration tokens). */
export class SecretStore {
  constructor(
    private readonly dir: string,
    private readonly cipher: SecretCipher
  ) {}

  private file(name: string) {
    if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new Error('invalid secret name');
    return path.join(this.dir, `${name}.secret`);
  }

  get(name: string): string | null {
    try {
      return this.cipher.decrypt(fs.readFileSync(this.file(name))).toString('utf8');
    } catch {
      return null;
    }
  }

  set(name: string, value: string | null) {
    const f = this.file(name);
    if (value === null) {
      fs.rmSync(f, { force: true });
      return;
    }
    if (!this.cipher.available()) throw new Error('OS secure storage is not available');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(f, this.cipher.encrypt(Buffer.from(value, 'utf8')), { mode: 0o600 });
  }
}
