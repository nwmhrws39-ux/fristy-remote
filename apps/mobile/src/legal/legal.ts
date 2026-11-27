import { LEGAL_CONTRACT_DOCS, LEGAL_VERSION, isAccepted, type LegalAcceptance } from '@fristy/shared';
import { readJson, writeJson } from '../store/secure';

/*
 * Legal acceptance on the phone: stored locally (encrypted keychain) with the
 * document version and timestamp. Nothing is sent to the owner service –
 * not even the check-in – until the current version has been accepted.
 */

const K = 'fristy.legal.v1';
const K_HISTORY = 'fristy.legalHistory.v1';
let current: LegalAcceptance | null = null;
let loaded = false;
const listeners = new Set<() => void>();

export const legalStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => current,
  loaded: () => loaded
};

function emit() {
  for (const l of listeners) l();
}

export async function loadLegal(): Promise<LegalAcceptance | null> {
  current = await readJson<LegalAcceptance | null>(K, null);
  loaded = true;
  emit();
  return current;
}

export const legalAccepted = () => isAccepted(current);

export async function acceptLegal(): Promise<LegalAcceptance> {
  const a: LegalAcceptance = { version: LEGAL_VERSION, acceptedAt: Date.now(), adult: true, documents: [...LEGAL_CONTRACT_DOCS] };
  const history = await readJson<LegalAcceptance[]>(K_HISTORY, []);
  await writeJson(K_HISTORY, [...history, a].slice(-20));
  await writeJson(K, a);
  current = a;
  emit();
  return a;
}

export async function withdrawLegal(): Promise<void> {
  await writeJson(K, null);
  current = null;
  emit();
}

export const legalHistory = () => readJson<LegalAcceptance[]>(K_HISTORY, []);
