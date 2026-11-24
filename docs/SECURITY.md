# Security model

FRISTY Remote lets a phone control a PC, so security is part of the core design. This
document describes the threat model, the cryptography and the controls, and it lists the
known limitations.

## Threat model

| Adversary | Mitigation |
|---|---|
| Someone on the same Wi-Fi sniffing traffic | All frames after the handshake are authenticated-encrypted (XSalsa20-Poly1305) |
| Someone on the Wi-Fi impersonating the PC (MITM) | Phone pins the PC's public key from the QR code; manual-code pairing shows a 6-digit verification code on both screens |
| Unpaired device trying to connect | Rejected unless its key is in the authorized device list; attempt logged + phone alert |
| Stolen pairing code | Single use, 2-minute expiry, 5 wrong attempts kill the session, **and** the PC owner must approve every new device |
| Replay / reordering / tampering | Strict per-direction nonce counters; any failure closes the connection |
| Brute force / flooding | Per-IP connection token bucket, failure lockout (10 / 10 min), per-session request rate limit, 512 KB frame cap, 10 s handshake timeout |
| Compromised or curious relay operator | Relay only sees ciphertext; it cannot read or forge commands. PCs must prove key ownership to register |
| Malicious phone app (paired) | Granular permissions; strict schema validation; no shell, no arbitrary executables, paths or URLs |
| Malicious web content in the desktop UI | Sandboxed renderer, context isolation, no Node, strict CSP, single validated IPC channel |

## Cryptography

Implemented with [TweetNaCl](https://tweetnacl.js.org) (audited, pure JS, identical in Node and
React Native). See `packages/shared/src/crypto.ts`.

- **Identities:** each PC and phone has a long-term X25519 key pair.
  - PC: private key encrypted with Windows DPAPI via Electron `safeStorage`. If OS encryption
    is unavailable, the key is **not** written in plaintext; a temporary key is used instead.
  - Phone: private key in iOS Keychain / Android Keystore-backed `expo-secure-store`
    (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, never synced to backups).
- **Handshake (per connection):** both sides send fresh ephemeral keys. The session key is
  `SHA-512(label ‖ cs ‖ ss ‖ ce ‖ se ‖ DH(ce,se) ‖ DH(cs,se) ‖ DH(ce,ss))`, split into
  separate send/receive keys. Only the holder of the phone's static private key can compute
  `DH(cs,se)`, and only the real PC can compute `DH(ce,ss)`. That gives mutual authentication
  and forward secrecy. Low-order points are rejected.
- **Frames:** `secretbox` with 24-byte nonces derived from strictly increasing counters.
- **SAS:** a 6-digit code derived from the session key, shown on both screens during pairing.
- **Phone RNG:** `tweetnacl` is wired to `expo-crypto.getRandomBytes` (platform CSPRNG).

### Why `ws://` and not `wss://` on the LAN?

TLS on a LAN needs either a public certificate (impossible for `192.168.x.x`) or a
self-signed certificate with custom pinning, which React Native's WebSocket does not support.
Encryption and authentication are therefore done one layer up. That gives the same
confidentiality, integrity and mutual authentication as pinned TLS, and it lets the relay stay
blind. For this reason the Android build sets `usesCleartextTraffic` and iOS sets
`NSAllowsLocalNetworking`. **No plaintext command ever crosses the network.** Internet relay
connections additionally use `wss://`, and the desktop refuses non-TLS relay URLs except
`localhost`.

## Authorization

- Every RPC method is listed in `packages/protocol/src/methods.ts` with a **Zod schema** and a
  **required permission**. Unknown methods, extra fields and out-of-range values are rejected.
- Permissions per device: `monitor, power, apps, games, input, audio, files, macros` (`screen`
  is reserved). The PC owner picks them at approval time and can change them live.
- **Remote input** needs the `input` permission **and** the global "Allow remote mouse &
  keyboard" switch. It is off by default. An always-on-top indicator shows on the PC while
  input is active. **Ctrl+Alt+Shift+F12** disables it immediately.
- **Shutdown/restart**, scheduled shutdown, closing games and closing apps require an
  explicit `confirm: true` that the phone only sends after a confirmation dialog.
- **Apps:** only executables added by the PC owner (file picker on the PC) can be launched,
  with fixed arguments and without a shell. Phones send only an app ID.
- **Games:** launched only through allow-listed official launcher URIs (`steam://rungameid/N`,
  `com.epicgames.launcher://apps/…?action=launch`, `uplay://launch/N/0`, `battlenet://CODE`),
  an owner-chosen exe, or a validated AppUserModelID. DRM and launcher sign-in are untouched.
- **Websites:** host allow-list, http(s) only, no embedded credentials.
- **Files:** only owner-chosen folders (system folders and whole drives are refused). Paths
  are resolved and re-checked after `realpath` (symlinks/junctions). `..`, absolute paths,
  drive letters, UNC paths, alternate data streams and reserved names are rejected. Uploads
  are written to a temp file and renamed, and never overwrite existing files.
- **Macros:** a fixed set of step types. A macro runs only if the device holds every
  permission its steps need.

## Electron hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`,
  DevTools disabled in packaged builds.
- Strict CSP (`script-src 'self'`, no remote code, no `eval`).
- Navigation, new windows and `<webview>` are blocked. All web permission requests are denied.
- One IPC entry point (`fristy:invoke`) with a channel allow-list, a Zod payload schema per
  channel, and a sender-frame origin check.
- The app runs as the logged-in user (`requestedExecutionLevel: asInvoker`) and never asks for
  elevation. The installer elevates once, only to install per-machine and add a firewall rule
  for **Private** networks.

## Privacy

- No telemetry, no accounts, no cloud dependency for LAN use.
- **Typed text and keystrokes are never stored or logged.** The log records only that input
  started for a session.
- Security log (pairings, rejections, permission denials, actions) stays on the PC and is
  capped at 5,000 entries.

## Explicit non-goals

- No hidden or unattended "stealth" access: the tray icon is always present, and every
  device must be approved on the PC.
- No bypass of Windows authentication, UAC or the secure desktop (Ctrl+Alt+Del, lock screen,
  credential prompts).
- No arbitrary command or script execution, from any feature.

## Known limitations

- Unsigned builds trigger Windows SmartScreen. Configure code signing for releases.
- The relay has no account system: anyone can open a channel to a *registered PC*, but the
  PC still rejects every unpaired device. Rate limits protect the relay. Run your own relay
  behind TLS.
- Manual-code pairing trusts the discovery beacon's public key. The 6-digit verification code
  shown on both screens is what detects a LAN MITM, so users must actually compare it.
  QR pairing does not have this caveat.

## Reporting vulnerabilities

Please report security issues privately to the FRISTY maintainers rather than in public issues.
