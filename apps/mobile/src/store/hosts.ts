import { readJson, writeJson } from './secure';

/** A paired computer as remembered by the phone. */
export interface PairedHost {
  /** desktop public key (base64) – pinned identity */
  pk: string;
  name: string;
  hosts: string[];
  port: number;
  deviceId: string;
  relayUrl: string | null;
  lastAddress: string | null;
  mac: string | null;
  broadcast: string | null;
  pairedAt: number;
}

const KEY = 'fristy.hosts.v1';
const ACTIVE = 'fristy.activeHost.v1';

export async function loadHosts(): Promise<PairedHost[]> {
  const list = await readJson<PairedHost[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveHost(h: PairedHost): Promise<PairedHost[]> {
  const list = (await loadHosts()).filter((x) => x.pk !== h.pk);
  list.unshift(h);
  await writeJson(KEY, list.slice(0, 8));
  return list;
}

export async function updateHost(pk: string, patch: Partial<PairedHost>): Promise<void> {
  const list = await loadHosts();
  await writeJson(
    KEY,
    list.map((h) => (h.pk === pk ? { ...h, ...patch } : h))
  );
}

export async function forgetHost(pk: string): Promise<PairedHost[]> {
  const list = (await loadHosts()).filter((x) => x.pk !== pk);
  await writeJson(KEY, list);
  return list;
}

export const getActiveHostKey = () => readJson<string | null>(ACTIVE, null);
export const setActiveHostKey = (pk: string | null) => writeJson(ACTIVE, pk);
