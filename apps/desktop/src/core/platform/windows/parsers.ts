/*
 * Pure parsers for launcher metadata. Kept free of I/O so they are unit-tested
 * on any OS with fixture strings.
 */

export type VdfNode = { [key: string]: string | VdfNode };

/** Minimal Valve KeyValues (VDF/ACF) parser. */
export function parseVdf(text: string): VdfNode {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push(m[1] !== undefined ? m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') : m[2]!);
  let i = 0;
  const parseObject = (): VdfNode => {
    const obj: VdfNode = {};
    while (i < tokens.length) {
      const key = tokens[i++]!;
      if (key === '}') return obj;
      const next = tokens[i++];
      if (next === '{') obj[key] = parseObject();
      else if (next !== undefined) obj[key] = next;
    }
    return obj;
  };
  return parseObject();
}

function lowerKeys(node: VdfNode): VdfNode {
  const out: VdfNode = {};
  for (const [k, v] of Object.entries(node)) out[k.toLowerCase()] = typeof v === 'string' ? v : lowerKeys(v);
  return out;
}

/** Returns library folder paths from steamapps/libraryfolders.vdf. */
export function steamLibraryPaths(vdfText: string): string[] {
  const root = lowerKeys(parseVdf(vdfText));
  const lf = (root['libraryfolders'] ?? root) as VdfNode;
  const paths: string[] = [];
  for (const v of Object.values(lf)) {
    if (typeof v === 'string') {
      if (/^[a-z]:[\\/]/i.test(v)) paths.push(v); // old format: "1" "D:\\Games"
    } else if (typeof v['path'] === 'string') {
      paths.push(v['path']);
    }
  }
  return paths;
}

/** Steam app ids that are tools/runtimes rather than games. */
const STEAM_NON_GAMES = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '1826330']);

export interface SteamManifest {
  appid: string;
  name: string;
  installdir: string;
}

export function parseSteamManifest(acfText: string): SteamManifest | null {
  const root = lowerKeys(parseVdf(acfText));
  const st = root['appstate'];
  if (!st || typeof st === 'string') return null;
  const appid = st['appid'];
  const name = st['name'];
  const installdir = st['installdir'];
  if (typeof appid !== 'string' || typeof name !== 'string' || typeof installdir !== 'string') return null;
  if (!/^\d+$/.test(appid) || STEAM_NON_GAMES.has(appid)) return null;
  if (/redistributable|proton|steam linux runtime|steamworks/i.test(name)) return null;
  return { appid, name, installdir };
}

export interface EpicManifest {
  displayName: string;
  installLocation: string;
  launchUri: string;
  appName: string;
}

export function parseEpicManifest(jsonText: string): EpicManifest | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (k: string) => (typeof j[k] === 'string' ? (j[k] as string) : null);
  const ns = s('CatalogNamespace');
  const item = s('CatalogItemId');
  const app = s('AppName');
  const name = s('DisplayName');
  const loc = s('InstallLocation');
  if (!ns || !item || !app || !name || !loc) return null;
  const cats = Array.isArray(j['AppCategories']) ? (j['AppCategories'] as unknown[]) : null;
  if (cats && !cats.includes('games')) return null;
  if (j['bIsIncompleteInstall'] === true) return null;
  const safe = /^[A-Za-z0-9_.-]+$/;
  if (!safe.test(ns) || !safe.test(item) || !safe.test(app)) return null;
  return {
    displayName: name,
    installLocation: loc,
    appName: app,
    launchUri: `com.epicgames.launcher://apps/${ns}%3A${item}%3A${app}?action=launch&silent=true`
  };
}

/** Parses `reg query <key> /s` output into { keyPath: { valueName: data } }. */
export function parseRegQuery(output: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const raw of output.split(/\r?\n/)) {
    if (/^HKEY_/.test(raw)) {
      current = {};
      result.set(raw.trim(), current);
      continue;
    }
    const m = /^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(raw);
    if (m && current) current[m[1]!] = m[3]!;
  }
  return result;
}

/** Battle.net product codes for the `battlenet://` launch protocol. */
export const BATTLENET_PRODUCTS: Record<string, string> = {
  'World of Warcraft': 'WoW',
  Overwatch: 'Pro',
  'Overwatch 2': 'Pro',
  'Diablo IV': 'Fen',
  'Diablo III': 'D3',
  'Diablo II Resurrected': 'OSI',
  Hearthstone: 'WTCG',
  'StarCraft II': 'S2',
  StarCraft: 'S1',
  'Heroes of the Storm': 'Hero',
  'Warcraft III': 'W3'
};

/** Rockstar titles and the executable that triggers the Rockstar Games Launcher (keeps DRM/auth intact). */
export const ROCKSTAR_TITLES: Record<string, string> = {
  'Grand Theft Auto V': 'PlayGTAV.exe',
  'Grand Theft Auto V Enhanced': 'PlayGTAV.exe',
  'Red Dead Redemption 2': 'RDR2.exe',
  'Red Dead Redemption': 'RDR.exe',
  'L.A. Noire': 'LANoire.exe',
  'Max Payne 3': 'MaxPayne3.exe',
  'Grand Theft Auto IV': 'GTAIV.exe'
};

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
