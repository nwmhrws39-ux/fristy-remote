# FRISTY Remote

**Control your Windows PC from your phone, securely.** Launch games and apps, manage power,
watch live hardware stats, use your phone as a touchpad and keyboard, control audio, transfer
files and run one-tap macros. It works over your home Wi-Fi with no account or server, and
optionally over the internet through an end-to-end-encrypted relay.

| | |
|---|---|
| Desktop | Windows 10/11 · Electron · React · TypeScript · Tailwind CSS · SQLite (sql.js) |
| Mobile | Android & iOS · React Native · Expo SDK 58 (development build) · TypeScript |
| Security | X25519 + XSalsa20-Poly1305 end-to-end encryption, pinned keys, owner-approved pairing, per-device permissions |
| Languages | English and Hebrew (full RTL), dark and light themes, five accent colors |

> **Status:** v0.1. See **[docs/FEATURES.md](docs/FEATURES.md)** for what is implemented, what
> is limited, and what is not supported yet. **Remote desktop streaming is not implemented**,
> and the Windows-native layer still needs verification on real Windows hardware
> ([docs/TESTING.md](docs/TESTING.md)).

## Quick start

### 1. PC

Download `FRISTY-Remote-Setup-x.y.z.exe` from the CI artifacts (or build it, see below) and
install it. The installer adds a firewall rule for **Private** networks only. Open FRISTY
Remote and click **Generate pairing code**.

### 2. Phone

Install the FRISTY Remote app (APK or TestFlight build, see the build docs), tap
**Scan QR code**, then check that the 6-digit code matches the one on the PC. On the PC,
choose permissions and click **Approve**. Done: the phone reconnects automatically from now on.

### 3. Optional

- **Mouse & keyboard:** off by default. Enable *Allow remote mouse & keyboard* on the PC and
  grant the device the *Mouse & keyboard* permission. **Ctrl+Alt+Shift+F12** on the PC stops
  remote input instantly.
- **Files:** add shared folders on the PC (Files page). Nothing else is visible to phones.
- **Apps & websites:** click *Detect installed* or add apps and approved websites on the Apps page.
- **Internet access:** run a relay ([docs/RELAY.md](docs/RELAY.md)) and enter its `wss://` URL in Settings.
- **Wake-on-LAN:** see the hardware/BIOS checklist in [docs/WAKE_ON_LAN.md](docs/WAKE_ON_LAN.md).

## Repository layout

```
apps/desktop         Electron app (src/core = testable Node core, src/main, src/preload, src/renderer)
apps/mobile          Expo / React Native app
apps/relay-server    Optional internet relay (+ Dockerfile)
packages/protocol    Wire protocol: Zod schemas, permissions, RPC method table
packages/shared      Encrypted channel, RemoteClient, rate limiter, WoL, i18n (EN/HE)
packages/ui          Shared design tokens and theme
tests/integration    Cross-package tests (phone ↔ relay ↔ PC)
tests/e2e            Real-Electron end-to-end test (Playwright)
docs                 Architecture, security, protocol, builds, features, roadmap
```

## Development

Requirements: **Node.js 22+**, npm 10. Windows is needed to exercise PC control; on other OSes
the desktop app runs with monitoring only and reports control features as unsupported.

```bash
npm ci                    # installs all workspaces
npm test                  # unit + integration tests (70)
npm run typecheck         # all workspaces
npm run desktop:dev       # Electron + Vite dev server
npm run mobile:start      # Metro for the development build (see docs/BUILD_ANDROID.md)
npm run relay:start       # local relay on :8443
npm run test:e2e          # Electron end-to-end test (xvfb-run on Linux)
```

## Building

| Target | Command | Docs |
|---|---|---|
| Windows installer (.exe) | `npm run desktop:dist` (on Windows, or CI `windows-latest`) | [docs/BUILD_WINDOWS.md](docs/BUILD_WINDOWS.md) |
| Android APK | `cd apps/mobile && eas build -p android --profile preview` | [docs/BUILD_ANDROID.md](docs/BUILD_ANDROID.md) |
| iOS | `cd apps/mobile && eas build -p ios` | [docs/BUILD_IOS.md](docs/BUILD_IOS.md) |
| Relay (Docker) | `docker build -f apps/relay-server/Dockerfile -t fristy-relay .` | [docs/RELAY.md](docs/RELAY.md) |

## Dependencies

| Package | Used for |
|---|---|
| `tweetnacl`, `tweetnacl-util` | X25519, XSalsa20-Poly1305, SHA-512, encoding (desktop, mobile, relay) |
| `zod` | Runtime validation of every message and IPC payload |
| `ws` | WebSocket server/client (desktop, relay) |
| `sql.js` | SQLite compiled to WebAssembly (no native rebuilds) |
| `systeminformation` | CPU/GPU/RAM/disk/network stats |
| `qrcode` | Pairing QR codes |
| `electron`, `electron-builder`, `esbuild`, `vite`, `react`, `tailwindcss`, `lucide-react` | Desktop app and packaging |
| `expo` + `expo-camera`, `expo-secure-store`, `expo-file-system`, `expo-document-picker`, `expo-image-picker`, `expo-media-library`, `expo-sharing`, `expo-notifications`, `expo-haptics`, `expo-keep-awake`, `expo-localization`, `expo-crypto`, `expo-build-properties` | Mobile platform features |
| `react-native-svg`, `lucide-react-native`, `react-native-safe-area-context` | Mobile UI |
| `react-native-udp` | LAN discovery and Wake-on-LAN (native, needs a dev build) |
| `vitest`, `playwright` | Tests |

Windows runtime requirements: PowerShell 5.1 and .NET Framework 4.x (present on all
Windows 10/11 installs). Optional: NVIDIA driver (`nvidia-smi`) for GPU load/temperature.

## Configuration

Desktop settings live in the app (stored in SQLite in `%APPDATA%\FRISTY Remote`):

| Setting | Default |
|---|---|
| Remote access (LAN) | on, TCP port **47800**, discovery UDP **47801** |
| Remote mouse & keyboard | **off** |
| Internet relay | off |
| Max transfer size | 2048 MB |
| Alerts | CPU ≥ 90 °C, GPU ≥ 85 °C, free disk ≤ 10 % |
| Start with Windows | off |

Relay server: `PORT`, `HOST`, `TLS_KEY_FILE`, `TLS_CERT_FILE`, `MAX_CHANNELS_PER_HOST`.

## Security

Every connection is mutually authenticated and end-to-end encrypted. Every new device must
be approved on the PC. Every request is schema-validated, permission-checked, rate-limited and
logged locally. No arbitrary commands, executables, paths or URLs can be sent from a phone.
No passwords or keystrokes are collected. There is no hidden access, and no bypass of Windows
authentication or UAC. Full details: **[docs/SECURITY.md](docs/SECURITY.md)**.

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't find/connect to the PC | Same Wi-Fi? Network set to **Private** in Windows? Try the IP shown in the PC sidebar. Run **Settings → Diagnostics** |
| Touchpad does nothing | Enable *Allow remote mouse & keyboard* on the PC and grant the *Mouse & keyboard* permission |
| CPU temperature shows N/A | Normal on most Windows PCs without a vendor sensor driver. FRISTY never invents values |
| PC control says "unsupported" | You're running the desktop app on a non-Windows OS |
| Native helper errors on managed PCs | Group policies (AppLocker / PowerShell Constrained Language Mode) can block the helper's `Add-Type`. Ask your administrator to allow `resources\fristy-helper.ps1` |
| "This device is not authorized" | The device was revoked or the PC identity changed. Pair again |

## Documentation

[Features & status](docs/FEATURES.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Security](docs/SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Testing](docs/TESTING.md) ·
[Relay](docs/RELAY.md) · [Wake-on-LAN](docs/WAKE_ON_LAN.md) ·
[Windows build](docs/BUILD_WINDOWS.md) · [Android build](docs/BUILD_ANDROID.md) ·
[iOS build](docs/BUILD_IOS.md) · [Integrations](docs/INTEGRATIONS.md) · [Roadmap](docs/ROADMAP.md)
