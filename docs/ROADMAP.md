# Roadmap

## Delivered in v0.1

- **Phase 1** – desktop + mobile apps, encrypted LAN connection, QR/manual pairing with owner approval.
- **Phase 2** – app launching, power controls, hardware monitoring, audio controls, game launcher.
- **Phase 3** – remote mouse & keyboard, file transfers, macros.
- **Phase 4 (partial)** – internet access through the blind relay, local notifications,
  FRISTY Launcher integration.
- **Phase 5 (partial)** – automated test suites, Windows installer pipeline, Android/iOS build docs.

See [FEATURES.md](FEATURES.md) for the exact status of each item.

## Next

### Remote desktop streaming (Phase 4)

Planned design:

- **Capture:** Electron `desktopCapturer` per monitor in a hidden, sandboxed capture window.
  Windows itself excludes DRM-protected surfaces and the secure desktop (UAC, lock screen,
  Ctrl+Alt+Del) from capture.
- **Transport:** WebRTC (`react-native-webrtc` on the phone). Signaling (SDP/ICE) travels
  inside the existing encrypted channel, so only authenticated devices can start a stream.
  DTLS-SRTP fingerprints are bound to the session via signaling. TURN on the relay host for
  internet use.
- **Controls:** resolution/fps caps, adaptive bitrate from WebRTC stats, monitor selection,
  pinch-zoom, tap-to-click mapped to absolute coordinates (`MOUSEEVENTF_ABSOLUTE |
  VIRTUALDESK`), optional system-audio loopback.
- **Consent:** new `screen` permission (already reserved) **plus** a per-session prompt on
  the PC, and a persistent red border/indicator while sharing.

### Other

- Windows SMTC (Global System Media Transport Controls) for now-playing + artwork
- Resumable file transfers
- Optional push notifications via a self-hosted push relay
- EA app / Xbox app automatic detection
- FRISTY PC Manager sensors (accurate CPU temperatures) and Cleaner actions
- Auto-update with signed releases
- Phone widgets / quick tiles for macros
