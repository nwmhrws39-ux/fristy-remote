# FRISTY Remote protocol (v1)

Transport: WebSocket text frames. LAN: `ws://<pc>:47800/fristy`. Relay: `wss://<relay>/relay`.
Maximum frame: 512 KB. Source of truth: `packages/protocol/src`.

## 1. Handshake (plaintext JSON)

```jsonc
// phone → PC
{ "t": "hello", "v": 1, "cs": "<phone static pk b64>", "ce": "<phone ephemeral pk b64>" }
// PC → phone
{ "t": "hello", "v": 1, "ss": "<PC static pk b64>", "se": "<PC ephemeral pk b64>" }
// PC → phone, instead of hello, when refusing before encryption
{ "t": "err", "code": "remote_disabled" | "rate_limited", "message": "…" }
```

Keys: `okm = SHA512("FRISTY-REMOTE-v1" ‖ cs ‖ ss ‖ ce ‖ se ‖ DH(ce,se) ‖ DH(cs,se) ‖ DH(ce,ss))`,
`c2s = okm[0..32]`, `s2c = okm[32..64]`, `sas = u32(SHA512(okm ‖ "sas")[0..4]) mod 10⁶`.

## 2. Encrypted frames

`{ "t": "e", "c": base64(secretbox(utf8(JSON), nonce(counter), key)) }`. The nonce is 24 bytes
with the big-endian counter in the last 8 bytes, starting at 0 in each direction. A frame
that fails to decrypt closes the connection.

## 3. Session opening (first encrypted message from the phone)

```jsonc
{ "kind": "auth", "deviceName": "Pixel" }                      // already paired
{ "kind": "pair", "pairingId": "…", "secret": "<b64>", "deviceName": "…", "platform": "android" } // QR
{ "kind": "pair", "pairingId": "…", "code": "K7Q2-9MXA", … }  // manual
```

PC replies (encrypted):

```jsonc
{ "kind": "pair_pending", "sas": "482913" }   // waiting for owner approval
{ "kind": "accepted", "deviceId": "…", "permissions": ["monitor", …], "paired": true,
  "host": { "hostId": "…", "computerName": "…", "appVersion": "…", "protocolVersion": 1,
            "inputEnabled": false, "relayUrl": null } }
{ "kind": "rejected", "code": "unknown_device|revoked|pairing_expired|pairing_invalid|pairing_denied|rate_limited|remote_disabled|protocol", "message": "…" }
```

## 4. RPC

```jsonc
{ "kind": "req", "id": 7, "method": "apps.launch", "params": { "appId": "chrome" } }
{ "kind": "res", "id": 7, "ok": true, "result": { "ok": true } }
{ "kind": "res", "id": 7, "ok": false, "error": { "code": "forbidden", "message": "…" } }
```

Error codes: `bad_request, unknown_method, forbidden, input_disabled, not_found,
confirmation_required, rate_limited, unsupported, limit_exceeded, internal`.

### Methods

| Method | Permission | Params |
|---|---|---|
| `session.ping` | – | `{t}` |
| `session.subscribeStats` | monitor | `{enabled}` |
| `system.info`, `system.stats` | monitor | `{}` |
| `power.action` | power | `{action: shutdown\|restart\|sleep\|hibernate\|lock\|monitorOff, confirm?}` (confirm required for shutdown/restart) |
| `power.schedule` | power | `{action: shutdown\|restart, delaySec: 30..86400, confirm: true}` |
| `power.cancelSchedule`, `power.scheduleState` | power | `{}` |
| `apps.list`, `apps.urls` | apps | `{}` |
| `apps.launch` / `apps.favorite` / `apps.close` | apps | `{appId}` / `{appId, favorite}` / `{appId, confirm: true}` |
| `apps.openUrl` | apps | `{url}` (host must be approved) |
| `games.list` | games | `{}` |
| `games.launch` / `games.favorite` / `games.close` | games | `{gameId}` / `{gameId, favorite}` / `{gameId, confirm: true}` |
| `input.mouseMove` | input | `{dx, dy}` (±2000) |
| `input.mouseButton` | input | `{button: left\|right\|middle, action: click\|double\|down\|up}` |
| `input.scroll` | input | `{dx, dy}` (±50 notches) |
| `input.text` | input | `{text}` (≤256 chars) |
| `input.key` | input | `{key: <KEY_NAMES>, modifiers: [ctrl\|alt\|shift\|win]}` |
| `audio.state` | audio | `{}` |
| `audio.setVolume` / `setMute` / `setMicMute` | audio | `{level}` / `{muted}` / `{muted}` |
| `audio.setAppVolume` / `setAppMute` | audio | `{pid, level}` / `{pid, muted}` |
| `audio.setDefaultDevice` | audio | `{deviceId, kind: output\|input}` |
| `audio.media` | audio | `{action: playPause\|next\|previous\|stop}` |
| `files.roots`, `files.history` | files | `{}` |
| `files.list` | files | `{rootId, path}` |
| `files.downloadStart` → `files.downloadChunk` | files | `{rootId, path}` → `{transferId, index}` |
| `files.uploadStart` → `files.uploadChunk` → `files.finish` | files | `{rootId, dir, name, size}` → `{transferId, index, data}` → `{transferId}` |
| `files.pause` / `files.cancel` | files | `{transferId, paused}` / `{transferId}` |
| `macros.list` / `macros.run` | macros | `{}` / `{macroId}` |

All parameter objects are `strict`: unknown keys are rejected.

### Events (PC → phone)

`{ "kind": "evt", "event": "<name>", "data": … }` with `stats`, `permissions`, `inputState`,
`alert {type, message}`, `powerSchedule`, `revoked`.

## 5. QR code

`fristy:` + JSON `{v:1, pk, pid, secret, hosts:[…], port, name, exp}`.

## 6. Discovery (UDP 47801)

Request: ASCII `FRISTY_DISCOVER_V1`. Reply (unicast JSON):
`{type:"fristy.beacon", v, name, pk, port, pairing, pid?}`.

## 7. Relay

See [RELAY.md](RELAY.md).
