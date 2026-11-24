import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ScannedGame } from '../types';
import {
  BATTLENET_PRODUCTS,
  ROCKSTAR_TITLES,
  parseEpicManifest,
  parseRegQuery,
  parseSteamManifest,
  slug,
  steamLibraryPaths
} from './parsers';

const execFileAsync = promisify(execFile);

async function regQuery(key: string, recursive = true): Promise<Map<string, Record<string, string>>> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, ...(recursive ? ['/s'] : [])], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    return parseRegQuery(stdout);
  } catch {
    return new Map();
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Steam ---------------- */

export async function scanSteam(): Promise<ScannedGame[]> {
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', false);
  let steamPath = [...reg.values()][0]?.['SteamPath'];
  if (!steamPath) steamPath = 'C:\\Program Files (x86)\\Steam';
  steamPath = path.win32.normalize(steamPath);
  let libraries = [steamPath];
  try {
    libraries = [...new Set([steamPath, ...steamLibraryPaths(await fs.readFile(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'))])];
  } catch {
    /* Steam not installed or no libraries file */
  }
  const games: ScannedGame[] = [];
  for (const lib of libraries) {
    const appsDir = path.join(lib, 'steamapps');
    let files: string[] = [];
    try {
      files = (await fs.readdir(appsDir)).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const m = parseSteamManifest(await fs.readFile(path.join(appsDir, f), 'utf8'));
        if (!m) continue;
        games.push({
          id: `steam:${m.appid}`,
          name: m.name,
          source: 'steam',
          launchKind: 'uri',
          launchTarget: `steam://rungameid/${m.appid}`,
          installDir: path.join(appsDir, 'common', m.installdir),
          artworkUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${m.appid}/header.jpg`
        });
      } catch {
        /* skip unreadable manifest */
      }
    }
  }
  return games;
}

/* ---------------- Epic Games ---------------- */

export async function scanEpic(): Promise<ScannedGame[]> {
  const dir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.item'));
  } catch {
    return [];
  }
  const games: ScannedGame[] = [];
  for (const f of files) {
    try {
      const m = parseEpicManifest(await fs.readFile(path.join(dir, f), 'utf8'));
      if (!m) continue;
      games.push({
        id: `epic:${m.appName}`,
        name: m.displayName,
        source: 'epic',
        launchKind: 'uri',
        launchTarget: m.launchUri,
        installDir: m.installLocation,
        artworkUrl: null
      });
    } catch {
      /* skip */
    }
  }
  return games;
}

/* ---------------- Ubisoft Connect ---------------- */

export async function scanUbisoft(): Promise<ScannedGame[]> {
  const reg = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs');
  const games: ScannedGame[] = [];
  for (const [key, values] of reg) {
    const id = /\\Installs\\(\d+)$/.exec(key)?.[1];
    const dir = values['InstallDir'];
    if (!id || !dir) continue;
    games.push({
      id: `ubisoft:${id}`,
      name: path.basename(dir.replace(/[\\/]+$/, '')),
      source: 'ubisoft',
      launchKind: 'uri',
      launchTarget: `uplay://launch/${id}/0`,
      installDir: path.win32.normalize(dir),
      artworkUrl: null
    });
  }
  return games;
}

/* ---------------- Rockstar Games Launcher ---------------- */

export async function scanRockstar(): Promise<ScannedGame[]> {
  const reg = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games');
  const games: ScannedGame[] = [];
  for (const [key, values] of reg) {
    const title = key.split('\\').pop() ?? '';
    const exe = ROCKSTAR_TITLES[title];
    const dir = values['InstallFolder'] ?? values['InstallFolderSteam'] ?? values['InstallFolderEpic'];
    if (!exe || !dir) continue;
    const full = path.join(dir, exe);
    if (!(await exists(full))) continue;
    games.push({
      id: `rockstar:${slug(title)}`,
      name: title,
      source: 'rockstar',
      launchKind: 'exe',
      launchTarget: full,
      installDir: dir,
      artworkUrl: null
    });
  }
  return games;
}

/* ---------------- Battle.net ---------------- */

export async function scanBattleNet(): Promise<ScannedGame[]> {
  const games: ScannedGame[] = [];
  for (const root of [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]) {
    const reg = await regQuery(root);
    for (const values of reg.values()) {
      if (!/Blizzard/i.test(values['Publisher'] ?? '')) continue;
      const name = values['DisplayName'] ?? '';
      const code = BATTLENET_PRODUCTS[name];
      if (!code) continue;
      games.push({
        id: `battlenet:${code}`,
        name,
        source: 'battlenet',
        launchKind: 'uri',
        launchTarget: `battlenet://${code}`,
        installDir: values['InstallLocation'] ?? null,
        artworkUrl: null
      });
    }
  }
  return games;
}

/**
 * EA app and Xbox app titles are not auto-detected in v0.1 (no stable public
 * manifest). They can be added manually: EA games by their executable (which
 * hands off to the EA app for DRM), Xbox/Store games by AppUserModelID.
 */
export async function scanAllGames(): Promise<ScannedGame[]> {
  const results = await Promise.allSettled([scanSteam(), scanEpic(), scanUbisoft(), scanRockstar(), scanBattleNet()]);
  const seen = new Set<string>();
  const out: ScannedGame[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const g of r.value) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return out;
}
