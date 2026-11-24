import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64, keyPairFromSecret, type KeyPair } from '@fristy/shared';

/*
 * tweetnacl needs a CSPRNG. Hermes has no WebCrypto, so we wire it to the
 * platform's secure random generator (iOS SecRandomCopyBytes / Android SecureRandom).
 */
nacl.setPRNG((x, n) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i]!;
});

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const IDENTITY_KEY = 'fristy.identity.v1';

let cached: KeyPair | null = null;

/**
 * The phone's long-term identity key. The secret key never leaves the device
 * and is stored in the iOS Keychain / Android Keystore-backed SecureStore.
 */
export async function getIdentity(): Promise<KeyPair> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(IDENTITY_KEY, OPTS);
  if (stored) {
    cached = keyPairFromSecret(decodeBase64(stored));
    return cached;
  }
  const kp = nacl.box.keyPair();
  await SecureStore.setItemAsync(IDENTITY_KEY, encodeBase64(kp.secretKey), OPTS);
  cached = { publicKey: kp.publicKey, secretKey: kp.secretKey };
  return cached;
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await SecureStore.getItemAsync(key, OPTS);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value), OPTS);
}

export async function remove(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTS);
}
