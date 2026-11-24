# FRISTY application integrations

FRISTY Remote works completely on its own. Integrations with other FRISTY apps are optional
and go through **documented, authenticated, localhost-only HTTP APIs**.

## FRISTY Launcher (implemented client)

Enable in **Settings → FRISTY Launcher integration**, set the API URL (default
`http://127.0.0.1:47820`) and paste the API token from FRISTY Launcher. The token is stored
encrypted with Windows DPAPI. Requests to non-loopback hosts are refused.

FRISTY Launcher must implement:

| Request | Response |
|---|---|
| `GET /v1/health` | `200 {"app":"FRISTY Launcher","version":"x.y.z","api":1}` |
| `GET /v1/games` | `200 {"games":[{"id":"abc","name":"…","artworkUrl":"https://…"|null,"installDir":"C:\\…"|null}]}` |
| `POST /v1/games/{id}/launch` | `204` (or `200`) once the launch was handed to the game's store client |

All requests carry `Authorization: Bearer <token>` and must be rejected with `401` otherwise.
`id` matches `^[A-Za-z0-9_.:-]{1,96}$`, and artwork URLs must be `https`. Games imported this
way get the source `fristy` and appear on the phone like any other game. Launching always
goes through FRISTY Launcher, which keeps store DRM and sign-in intact. Click **Rescan** on the
Games page after enabling the integration.

## FRISTY PC Manager / FRISTY Cleaner (reserved)

The same conventions apply (loopback, bearer token, `/v1/health`). The intended surface for
a future release:

| App | Endpoint | Remote feature |
|---|---|---|
| PC Manager | `GET /v1/sensors` | richer CPU/GPU temperatures than WMI provides |
| PC Manager | `GET /v1/profiles`, `POST /v1/profiles/{id}/apply` | power/performance profiles as macro steps |
| Cleaner | `POST /v1/scan`, `GET /v1/scan/{id}` | start a cleanup scan from the phone, show results |

These need new protocol methods and permissions, so they are deliberately **not** callable
until implemented and reviewed.

## Integrating *with* FRISTY Remote

FRISTY Remote does not expose a local control API to other programs in v0.1. This prevents
other local software from using it to escalate into remote control.
