# Building the Windows app and installer

## Requirements

- Windows 10 (1903+) or Windows 11, x64
- Node.js 22 LTS and npm 10
- Git
- (optional) a code-signing certificate (`.pfx`) to avoid SmartScreen warnings

## Development

```bash
npm ci
npm run desktop:dev
```

This bundles the main/preload processes with esbuild, starts the Vite dev server for the
renderer, and launches Electron against it.

## Production installer

```bash
npm ci
npm run desktop:dist
```

Output: `apps/desktop/release/FRISTY-Remote-Setup-<version>.exe` (NSIS, x64).

The installer:

- installs per-machine (asks for elevation **once**, at install time);
- adds an inbound Windows Firewall rule for **Private networks only** (TCP 47800, UDP 47801)
  for `FRISTY Remote.exe`, and removes it on uninstall;
- creates Start-menu and desktop shortcuts;
- runs the app as the normal logged-in user (`asInvoker`). The app never requests admin rights.

### Code signing

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "…"
npm run desktop:dist
```

In GitHub Actions, set the repository secrets `WIN_CSC_LINK` (base64 of the .pfx) and
`WIN_CSC_KEY_PASSWORD`. The `windows-installer` job in `.github/workflows/ci.yml` builds and
uploads the installer as an artifact on every push to `main`.

### Building on Linux/macOS

`electron-builder` needs Wine (with 32-bit support) to build NSIS installers off Windows.
The CI workflow uses a `windows-latest` runner instead, which is the recommended path.
`npm run dist:dir -w @fristy/desktop` produces the unpacked app
(`release/win-unpacked/FRISTY Remote.exe`) without Wine.

## What gets packaged

Everything is bundled (esbuild for main/preload, Vite for the renderer), so the app ships no
`node_modules`:

```
resources/app.asar        dist/main (+ sql-wasm.wasm), dist/preload, dist/renderer
resources/fristy-helper.ps1   Windows native helper (input, audio, power, processes)
resources/docs/*.md       this documentation
```

## Data locations

- Database: `%APPDATA%\FRISTY Remote\fristy-remote.db` (SQLite)
- Identity key: `%APPDATA%\FRISTY Remote\identity.key` (DPAPI-encrypted)
- Uninstalling keeps these files; delete the folder to reset pairings.

## Firewall

If phones cannot connect, make sure Windows considers your Wi-Fi/Ethernet a **Private
network** (Settings → Network & Internet → Properties). The app never asks you to disable the
firewall. On public networks it is intentionally unreachable.
