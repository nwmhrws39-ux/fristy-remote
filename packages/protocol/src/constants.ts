/** Wire protocol version. Bump on any breaking change to handshake or message shapes. */
export const PROTOCOL_VERSION = 1;

/** TCP port the desktop WebSocket control server listens on (LAN mode). */
export const DEFAULT_CONTROL_PORT = 47800;

/** UDP port used for LAN discovery requests/replies. */
export const DISCOVERY_PORT = 47801;

/** Magic strings used in UDP discovery datagrams. */
export const DISCOVERY_REQUEST = 'FRISTY_DISCOVER_V1';
export const DISCOVERY_REPLY_TYPE = 'fristy.beacon';

/** Maximum size of a single WebSocket frame (bytes). Larger frames are rejected. */
export const MAX_FRAME_BYTES = 512 * 1024;

/** File transfer chunk size (raw bytes, before base64). */
export const FILE_CHUNK_BYTES = 128 * 1024;

/** Pairing sessions expire after this many milliseconds. */
export const PAIRING_TTL_MS = 2 * 60 * 1000;

/** Max wrong pairing codes per pairing session before it is invalidated. */
export const PAIRING_MAX_ATTEMPTS = 5;

/** The handshake must finish within this window or the socket is closed. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Authenticated sessions are forcibly re-keyed after this age. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Sessions with no traffic (including pings) for this long are closed. */
export const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

/** How often the desktop pushes live stats to subscribed devices. */
export const STATS_INTERVAL_MS = 1000;
