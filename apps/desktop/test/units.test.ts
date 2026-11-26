import { describe, expect, it } from 'vitest';
import { PairingManager } from '../src/core/pairing';
import { isApprovedUrl } from '../src/core/services/apps';
import { isAllowedLaunchUri } from '../src/core/services/games';
import { stepPermission } from '../src/core/services/macros';
import { validateFileName } from '../src/core/services/files';
import { processesForExecutable, processesInDirectory } from '../src/core/services/processes';
import { parseEpicManifest, parseRegQuery, parseSteamManifest, steamLibraryPaths } from '../src/core/platform/windows/parsers';
import { isLoopbackUrl } from '../src/core/integrations/fristy-launcher';
import { VK } from '../src/core/platform/windows/keys';
import { KEY_NAMES } from '@fristy/protocol';

describe('PairingManager', () => {
  it('expires sessions', () => {
    let now = 0;
    const pm = new PairingManager(() => now, 1000);
    const s = pm.create();
    expect(s.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    now = 2000;
    expect(pm.verify(s.pairingId, { secret: s.secret })).toEqual({ ok: false, reason: 'pairing_expired' });
  });
  it('rejects a wrong pairing id even with the right secret', () => {
    const pm = new PairingManager();
    const s = pm.create();
    expect(pm.verify('other-id-123', { secret: s.secret }).ok).toBe(false);
    expect(pm.verify(s.pairingId, { secret: s.secret }).ok).toBe(true);
  });
});

describe('launch target validation', () => {
  it('only allows official launcher URIs', () => {
    expect(isAllowedLaunchUri('steam://rungameid/620')).toBe(true);
    expect(isAllowedLaunchUri('com.epicgames.launcher://apps/fn%3A4fe7%3AFortnite?action=launch&silent=true')).toBe(true);
    expect(isAllowedLaunchUri('uplay://launch/635/0')).toBe(true);
    expect(isAllowedLaunchUri('battlenet://WoW')).toBe(true);
    expect(isAllowedLaunchUri('steam://rungameid/620 && calc')).toBe(false);
    expect(isAllowedLaunchUri('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isAllowedLaunchUri('ms-settings:')).toBe(false);
    expect(isAllowedLaunchUri('steam://run/620//-console')).toBe(false);
  });
  it('approves websites by host', () => {
    const list = [{ id: '1', label: 'YT', url: 'https://youtube.com/' }];
    expect(isApprovedUrl('https://youtube.com/watch', list)).toBe(true);
    expect(isApprovedUrl('https://m.youtube.com/', list)).toBe(true);
    expect(isApprovedUrl('https://youtube.com.evil.io/', list)).toBe(false);
    expect(isApprovedUrl('https://user:pw@youtube.com/', list)).toBe(false);
    expect(isApprovedUrl('javascript:alert(1)', list)).toBe(false);
  });
  it('only talks to FRISTY Launcher on loopback', () => {
    expect(isLoopbackUrl('http://127.0.0.1:47820')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.2:47820')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.com')).toBe(false);
  });
});

describe('file names', () => {
  it('rejects dangerous names', () => {
    for (const bad of ['..', 'a/b', 'a\\b', 'C:x', 'NUL', 'com1.txt', 'x.', 'x ', 'a\u0000b', 'a:stream']) {
      expect(() => validateFileName(bad), bad).toThrow();
    }
    expect(validateFileName('photo 1.jpg')).toBe('photo 1.jpg');
    expect(validateFileName('תמונה.png')).toBe('תמונה.png');
  });
});

describe('macro permissions', () => {
  it('maps every step to the permission it needs', () => {
    expect(stepPermission({ type: 'launchApp', appId: 'x' })).toBe('apps');
    expect(stepPermission({ type: 'power', action: 'lock' })).toBe('power');
    expect(stepPermission({ type: 'wait', ms: 1 })).toBeNull();
  });
});

describe('process matching', () => {
  const procs = [
    { pid: 1, name: 'Discord', path: 'C:\\Users\\a\\AppData\\Local\\Discord\\app-1\\Discord.exe', title: null },
    { pid: 2, name: 'portal2', path: 'D:\\Steam\\steamapps\\common\\Portal 2\\portal2.exe', title: null },
    { pid: 3, name: 'other', path: 'D:\\Steam\\steamapps\\common\\Portal 2 Extra\\x.exe', title: null }
  ];
  it('matches by path or process name', () => {
    expect(processesForExecutable(procs, 'C:\\X\\Update.exe', 'Discord').map((p) => p.pid)).toEqual([1]);
  });
  it('matches by install directory without prefix confusion', () => {
    expect(processesInDirectory(procs, 'd:\\steam\\steamapps\\common\\Portal 2').map((p) => p.pid)).toEqual([2]);
  });
});

describe('key map', () => {
  it('has a virtual-key code for every allowed key', () => {
    for (const k of KEY_NAMES) expect(VK[k], k).toBeTypeOf('number');
  });
});

describe('launcher parsers', () => {
  it('parses Steam libraries and manifests', () => {
    const vdf = `"libraryfolders"
{
  "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "228980" "1" } }
  "1" { "path" "D:\\\\SteamLibrary" }
}`;
    expect(steamLibraryPaths(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
    const acf = `"AppState" { "appid" "620" "name" "Portal 2" "installdir" "Portal 2" "StateFlags" "4" }`;
    expect(parseSteamManifest(acf)).toEqual({ appid: '620', name: 'Portal 2', installdir: 'Portal 2' });
    expect(parseSteamManifest(`"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "x" }`)).toBeNull();
  });

  it('parses Epic manifests and builds the official launch URI', () => {
    const m = parseEpicManifest(
      JSON.stringify({
        DisplayName: 'Fortnite',
        InstallLocation: 'C:\\Epic\\Fortnite',
        CatalogNamespace: 'fn',
        CatalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5',
        AppName: 'Fortnite',
        AppCategories: ['public', 'games']
      })
    );
    expect(m?.launchUri).toBe('com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true');
    expect(isAllowedLaunchUri(m!.launchUri)).toBe(true);
    expect(parseEpicManifest('{"DisplayName":"x","AppCategories":["plugins"]}')).toBeNull();
    expect(parseEpicManifest('not json')).toBeNull();
  });

  it('parses reg query output', () => {
    const out = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\635',
      '    InstallDir    REG_SZ    C:/Games/Ubisoft/Far Cry 3/',
      ''
    ].join('\r\n');
    const m = parseRegQuery(out);
    expect([...m.values()][0]).toEqual({ InstallDir: 'C:/Games/Ubisoft/Far Cry 3/' });
  });
});

describe('native helper script', () => {
  it('every operation maps to an existing C# method and braces are balanced', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const s = fs.readFileSync(path.join(__dirname, '..', 'resources', 'fristy-helper.ps1'), 'utf8');
    const cs = s.slice(s.indexOf("$source = @'") + 12, s.indexOf("'@\n"));
    expect(cs.split('{').length).toBe(cs.split('}').length);
    const ops = [...s.matchAll(/\[Fristy\.(\w+)\]::(\w+)\(/g)].map((m) => m[2]!);
    expect(ops.length).toBeGreaterThan(15);
    for (const m of ops) expect(new RegExp(`public static \\S+(?:<[^>]+>)? ${m}\\(`).test(cs), m).toBe(true);
    for (const op of ['lock', 'monitorOff', 'monitorOn', 'sleep', 'hibernate', 'speak', 'moveTo']) expect(s).toContain(`'${op}'`);
  });
});
