# Internet access – relay server

LAN mode needs no server, account or subscription. To reach a PC from another network
(mobile data, work, travel), run a FRISTY relay and point the PC at it. No ports are opened on
the home router.

## How it works

1. The PC connects **outbound** to `wss://relay/relay` and sends its public key.
2. The relay encrypts a random challenge to that key. The PC must decrypt it to prove it owns
   the key (nobody else can register as your PC).
3. A phone connects and asks for the PC by public key. The relay allocates a channel and
   forwards opaque strings in both directions.
4. Phone and PC run the **same end-to-end handshake** as on the LAN. The PC authenticates
   the device and enforces its permissions. The relay sees only ciphertext and can neither
   read nor inject commands.

The phone learns the relay URL from the PC when it connects on the LAN, then tries LAN
addresses first and falls back to the relay.

## Running the relay

```bash
# from the repository root
docker build -f apps/relay-server/Dockerfile -t fristy-relay .
docker run -d --restart unless-stopped -p 8443:8443 fristy-relay
```

or without Docker:

```bash
npm ci
npm run relay:start          # builds dist/relay.js and runs it (PORT=8443)
```

Put it behind TLS. Either set `TLS_KEY_FILE` and `TLS_CERT_FILE`, or use a reverse proxy,
for example Caddy:

```
relay.example.com {
  reverse_proxy /relay* localhost:8443
  reverse_proxy /health localhost:8443
}
```

Then on the PC: **Settings → Internet access via relay**, enter `wss://relay.example.com/relay`
and enable it. The desktop refuses plain `ws://` relays except on `localhost`.

## Environment variables

| Variable | Default | |
|---|---|---|
| `PORT` | `8443` | listen port |
| `HOST` | `0.0.0.0` | bind address |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | – | serve `wss://` directly |
| `MAX_CHANNELS_PER_HOST` | `8` | concurrent phone connections per PC |

## Protections

Per-IP connection rate limiting (also honoring `X-Forwarded-For`), 10 s registration
timeout, frame size cap (1 MB), channel limit per PC, 30 s heartbeats that drop dead
sockets, and a `/health` endpoint. The relay stores nothing on disk.

## Not included

NAT traversal / direct peer-to-peer (STUN/ICE) is not implemented. All internet traffic goes
through the relay, which adds one network hop of latency.
