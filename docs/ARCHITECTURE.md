# Architecture

```
┌──────────────── Phone (Expo / React Native) ───────────────┐
│  Screens ── ConnectionManager ── RemoteClient (shared)      │
│              │  LAN ws://pc:47800/fristy   (encrypted)      │
│              │  or relay wss://…/relay      (encrypted)      │
│  UDP: discovery (47801) · Wake-on-LAN (9/7)                 │
└──────────────┼─────────────────────────────────────────────┘
               │  X25519 handshake → XSalsa20-Poly1305 frames
┌──────────────┼──────── Windows PC (Electron) ───────────────┐
│ Main process                                                │
│  FristyCore ── ControlServer ── handlers ── services        │
│      │            │  (auth, pairing, permissions,           │
│      │            │   rate limits, sessions)                │
│      │            └─ RelayClient (outbound, optional)       │
│      ├─ Store (SQLite via sql.js)                           │
│      ├─ DiscoveryResponder (UDP 47801)                      │
│      └─ Platform (Windows) ── NativeHelper (PowerShell+C#)   │
│                              SendInput · Core Audio ·      │
│                              power · processes             │
│  Tray · global emergency shortcut · input indicator         │
│ Preload: contextBridge → one validated IPC channel          │
│ Renderer (sandboxed React + Tailwind)                       │
└─────────────────────────────────────────────────────────────┘
               ▲
┌──────────────┴──────── Relay server (optional) ─────────────┐
│ Blind forwarder: host key-ownership challenge, channels,    │
│ rate limits. Never sees plaintext.                          │
└─────────────────────────────────────────────────────────────┘
```

## Monorepo

| Path | Purpose |
|---|---|
| `packages/protocol` | Wire constants, Zod schemas, permission model, typed RPC method table, relay frames |
| `packages/shared` | Secure channel (handshake, sessions), `RemoteClient`, rate limiter, WoL packet, formatting, i18n (EN/HE) |
| `packages/ui` | Design tokens (palette, accents, radii), `theme.css` for the desktop, logo |
| `apps/desktop` | Electron app. `src/core` is Electron-free and fully testable in Node |
| `apps/mobile` | Expo app (dev client) |
| `apps/relay-server` | Relay server + Dockerfile |
| `tests/integration` | Cross-package tests (phone ↔ relay ↔ PC) |
| `tests/e2e` | Real-Electron end-to-end test driven by Playwright |
| `docs` | Documentation |

## Desktop core (`apps/desktop/src/core`)

- `index.ts` – `FristyCore`: wires settings, store, server, discovery, relay, services, stats loop, alerts.
- `server.ts` – `ControlServer`: connection state machine
  `hello → open(auth | pair → pending approval) → ready`. Per-request: schema validation,
  permission check, input gate, rate limit, audit log.
- `handlers.ts` – maps each method to a service call.
- `services/` – apps, games (scan, launch, playtime tracking), files (safe paths,
  chunked transfers), macros, process cache.
- `platform/windows/` – PowerShell helper bridge, game scanners and parsers, VK codes.
  `platform/unsupported.ts` is used on non-Windows hosts (dev/CI): monitoring works, control
  operations return `unsupported`.
- `db.ts` – SQLite schema and migrations (sql.js = SQLite compiled to WebAssembly, persisted
  atomically). No native module to rebuild for Electron.
- `identity.ts` – PC key pair and secrets via an OS cipher (Electron `safeStorage`).

### Why a PowerShell + C# helper?

Native Node add-ons (robotjs, etc.) need per-Electron-version rebuilds and are often
unmaintained. Instead, one long-lived `powershell.exe` process compiles a small C# class
(`Add-Type`) that calls `SendInput`, Core Audio COM, `SetSuspendState`, `LockWorkStation` and
process APIs. It speaks line-delimited JSON with a **fixed operation list** and cannot run
arbitrary commands. Every Windows 10/11 machine has PowerShell 5.1 and .NET Framework 4.x.

## Mobile (`apps/mobile`)

- `src/connection/manager.ts` – single connection to the active PC: tries known LAN addresses,
  then the relay, then reconnects with backoff. Measures latency, keeps a stats history, and
  routes events to notifications.
- `src/connection/transfers.ts` – chunked file transfers using the `expo-file-system` File API.
- `src/connection/udp.ts` – discovery + Wake-on-LAN (`react-native-udp`, dev build only).
- `src/store/*` – identity key and data in SecureStore.
- `src/screens/*` – Pair, Dashboard, Power, Games, Apps, Touchpad, Audio, Files, Macros, Settings.
- Navigation is a small built-in tab bar (no navigation library), with RTL handled through a
  `row` direction from the theme context.

## Data flow example: "PLAY" on a Steam game

1. Phone → `games.launch {gameId: "steam:620"}` (encrypted).
2. Server: method known ✓, device has `games` ✓, rate limit ✓, params valid ✓, logged.
3. `GameService.launch` re-checks the stored target against the official-URI allow-list and
   calls `shell.openExternal("steam://rungameid/620")`.
4. Steam starts the game with its normal DRM/sign-in. The 5-second tracker sees the process
   inside the install directory, marks it running and accumulates playtime. A `gameLaunched`
   alert goes to phones with the `games` permission.
