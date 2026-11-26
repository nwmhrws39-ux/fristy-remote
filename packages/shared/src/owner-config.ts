/**
 * Address of the optional FRISTY owner service (apps/admin-server).
 * Not a secret: it only tells the apps where to check in. Builds can override it
 * with EXPO_PUBLIC_ADMIN_API_URL / FRISTY_ADMIN_API_URL. Empty = admin panel off.
 */
export const DEFAULT_ADMIN_API_URL = 'https://fristy-admin.nwmhrws39.workers.dev';
