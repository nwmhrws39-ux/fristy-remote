# Testing

## Automated

```bash
npm test             # 70 Vitest unit + integration tests (any OS)
npm run typecheck    # all six workspaces
npm run test:e2e     # real Electron app driven by Playwright (needs a display; use xvfb-run on Linux)
```

| Suite | What it proves |
|---|---|
| `packages/shared/test/crypto.test.ts` | Handshake key agreement, SAS match, replay/reorder/tamper rejection, impostor PC and impostor phone both fail, low-order keys rejected, relay ownership proof |
| `packages/protocol/test` | Method table: unknown methods, strict params, required confirmations, key whitelist, QR payloads |
| `apps/desktop/test/server.test.ts` | Real WebSocket server + real client: unknown device rejected, QR/manual pairing with approval, single-use codes, attempt limit, deny, PC-key pinning, revocation, remote-access switch, garbage handshakes, per-device permissions (static and live), confirmations, input gate + emergency stop, approved URLs, official launcher URIs, macros permission check, stats push, file listing/download/upload, traversal and symlink escapes, read-only folders, reserved names, size limits, pause/resume/cancel |
| `apps/desktop/test/units.test.ts` | Pairing expiry, launch-URI allow-list, URL allow-list, file names, Steam VDF/ACF, Epic manifests, `reg query` parsing, process matching, VK map |
| `tests/integration/relay.test.ts` | Phone → relay → PC with full auth and permissions; unknown device via relay; offline PC; key-ownership spoofing rejected |
| `tests/e2e/electron-smoke.mjs` | Packaged-app code in real Electron: renderer has no Node, IPC rejects unknown channels/bad payloads, server listens, unknown phone rejected, QR pairing with approval **through the UI** and matching codes, permission enforcement, revocation, audit log |

CI (`.github/workflows/ci.yml`) runs all of the above, bundles the mobile app for Android and
iOS with Metro, builds the relay image, and builds the NSIS installer on `windows-latest`.

## Manual verification on Windows (required before release)

The Windows-native layer cannot run on Linux CI. Check each item on Windows 10 **and** 11:

- [ ] Installer installs and uninstalls; firewall rule exists only for the Private profile
- [ ] App starts as a standard user (no UAC prompt), tray icon and menu work, "Start with Windows" works
- [ ] Pair Android and iOS phones via QR and via manual code (LAN discovery on Android)
- [ ] Dashboard values match Task Manager; unavailable sensors show N/A
- [ ] Lock, monitor off, sleep, hibernate (with `powercfg /hibernate on`), restart, shutdown, scheduled shutdown + cancel
- [ ] Wake-on-LAN from S3/S4/S5 on a wired PC with WoL enabled
- [ ] Steam, Epic, Ubisoft, Battle.net, Rockstar games detected and launched; running state, playtime, close game
- [ ] EA (exe) and Xbox (AUMID) manual games launch
- [ ] Apps: presets detected, custom exe, icons shown, launch/close, approved URL opens
- [ ] Touchpad: move, tap, right click, double click, drag & drop, scroll both axes, sensitivity
- [ ] Keyboard: Unicode text (including Hebrew), shortcuts, media keys; indicator appears; Ctrl+Alt+Shift+F12 stops input
- [ ] Audio: master volume/mute, mic mute, per-app volume, switch output/input device, now playing (Spotify)
- [ ] Files: upload photos/videos/documents, download, pause/resume/cancel, history, size limit
- [ ] Macros: default macros, custom macro editor, permission-restricted macro refused
- [ ] Relay: connect from mobile data via `wss://` relay
- [ ] Hebrew/RTL layout on desktop and mobile; light theme; accent colors
