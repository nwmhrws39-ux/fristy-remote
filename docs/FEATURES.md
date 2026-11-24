# Feature status

Legend: ✅ implemented · ⚠️ implemented with limitations · ❌ not implemented (yet) · 🔒 intentionally not supported

> **Verification note.** All protocol, security, pairing, permission, file-transfer, relay and
> server logic is covered by automated tests (unit, integration and a real-Electron E2E test)
> that run on Linux. The **Windows-native layer** (`apps/desktop/resources/fristy-helper.ps1`,
> `apps/desktop/src/core/platform/windows/*`): SendInput, Core Audio COM, `shutdown.exe`,
> registry and launcher-manifest scanning. It is written against documented Windows APIs, but
> it **must be verified on real Windows 10/11 hardware** before release; see the checklist in
> [TESTING.md](TESTING.md). The mobile app typechecks and bundles with Metro for Android and iOS.
> It has not been run on a physical phone in this environment.

## Phase 1 – Foundation

| Feature | Status | Notes |
|---|---|---|
| Desktop app (Electron + React + TS + Tailwind) | ✅ | Tray, dashboard, devices, games, apps, macros, files, security log, settings |
| Mobile app (Expo / React Native + TS) | ✅ | Needs a development build (UDP module); see BUILD_ANDROID/IOS |
| Local network connection (WebSocket) | ✅ | Port 47800, end-to-end encrypted frames |
| LAN discovery | ⚠️ | UDP broadcast 47801. iOS needs Apple's multicast entitlement; QR + manual IP always work |
| QR pairing + manual code + PC confirmation | ✅ | One-time codes, 2-minute expiry, 5-attempt limit, matching 6-digit verification code |
| Multiple devices, revoke, live permissions | ✅ | |
| Automatic reconnection | ✅ | Exponential backoff, LAN addresses first, then relay |

## Phase 2 – Control

| Feature | Status | Notes |
|---|---|---|
| Shutdown / restart (with confirmation) | ✅ | `shutdown.exe /s|/r /t 0` |
| Sleep / hibernate / lock / monitor off | ✅ | `SetSuspendState`, `LockWorkStation`, `SC_MONITORPOWER` |
| Scheduled shutdown + cancel | ✅ | `shutdown /s /t N`, `shutdown /a` |
| Wake-on-LAN | ⚠️ | Works only with compatible hardware/BIOS, wired Ethernet, same LAN. See [WAKE_ON_LAN.md](WAKE_ON_LAN.md) |
| CPU / RAM / storage / network / uptime | ✅ | |
| CPU temperature | ⚠️ | Most Windows PCs expose no CPU temperature without a vendor sensor driver → shown as **N/A** |
| GPU usage / temperature | ⚠️ | NVIDIA via `nvidia-smi`; other GPUs → **N/A** |
| Currently running game, playtime | ✅ | Process ↔ install-directory matching, 5 s resolution |
| Connection latency | ✅ | Encrypted ping every 5 s |
| Steam / Epic / Ubisoft / Battle.net detection | ✅ | Official manifests / registry, launched via official protocol URIs |
| Rockstar detection | ⚠️ | Known titles only (GTA V, RDR2, …), launched via the game's launcher-handoff exe |
| EA app / Xbox app games | ⚠️ | Not auto-detected: add manually (EA: game exe; Xbox/Store: AppUserModelID) |
| Game artwork | ⚠️ | Steam CDN art automatically; others via optional HTTPS URL |
| Close game (with confirmation) | ✅ | Graceful WM_CLOSE first, forced after 8 s |
| App launcher (approved list only) + icons | ✅ | Presets: Chrome, Discord, Spotify, OBS, VS Code, Steam |
| Open approved websites | ✅ | Host allow-list |
| Master volume / mute / mic mute | ✅ | Core Audio `IAudioEndpointVolume` |
| Per-application volume | ✅ | `IAudioSessionManager2` |
| Output / input device selection | ⚠️ | Uses the undocumented-but-stable `IPolicyConfig` (as used by EarTrumpet/SoundSwitch) |
| Media keys | ✅ | |
| Now-playing info | ⚠️ | Spotify window title only; Windows SMTC integration not implemented |

## Phase 3 – Input, files, macros

| Feature | Status | Notes |
|---|---|---|
| Touchpad: move, click, right/double click, drag, scroll | ✅ | Acceleration, sensitivity, full-screen mode |
| Virtual keyboard, shortcuts, media keys | ✅ | Unicode text via `KEYEVENTF_UNICODE` |
| Explicit permission + global PC switch + indicator | ✅ | Off by default; on-screen indicator while active |
| Emergency disconnect shortcut | ✅ | **Ctrl+Alt+Shift+F12** |
| Ctrl+Alt+Del, UAC prompts, lock screen | 🔒 | Windows secure desktop is never injected into (by design) |
| File upload / download, images & videos | ✅ | 128 KB encrypted chunks, save to gallery / share sheet |
| Progress, pause, cancel, history, size limits | ✅ | |
| Approved shared folders, traversal protection | ✅ | `..`, absolute, UNC, ADS and symlink escapes rejected (tested) |
| Resume after disconnect | ❌ | A dropped transfer must be restarted |
| Macros (whitelisted steps, icons, colors) | ✅ | Each step permission-checked |

## Phase 4 – Remote

| Feature | Status | Notes |
|---|---|---|
| Internet access via relay | ✅ | Blind E2E-encrypted relay, PC proves key ownership, see [RELAY.md](RELAY.md) |
| NAT traversal / peer-to-peer | ❌ | The relay is used instead; no hole punching |
| **Remote desktop streaming (WebRTC)** | ❌ | Not implemented in v0.1. The `screen` permission is reserved and cannot be granted. Design notes in [ROADMAP.md](ROADMAP.md) |
| Mobile notifications | ⚠️ | Local notifications from live events while the app runs / is recently backgrounded. No push server, so a fully closed app gets nothing |
| FRISTY Launcher integration | ✅ | Optional, localhost-only, token in OS secure storage. Spec in [INTEGRATIONS.md](INTEGRATIONS.md) |
| FRISTY PC Manager / Cleaner | ❌ | API contract reserved, no client code yet |

## Phase 5 – Release

| Item | Status | Notes |
|---|---|---|
| Unit + integration tests | ✅ | 70 Vitest tests |
| Electron E2E test | ✅ | `tests/e2e/electron-smoke.mjs` |
| Windows NSIS installer | ✅ | Built by CI on `windows-latest`; firewall rule limited to Private networks |
| Code signing | ❌ | Configure `WIN_CSC_LINK` secrets; unsigned builds show SmartScreen |
| Android APK / iOS build | ✅ | Instructions in [BUILD_ANDROID.md](BUILD_ANDROID.md), [BUILD_IOS.md](BUILD_IOS.md) |
| Auto-update | ❌ | Not implemented (`publish: null`) |
