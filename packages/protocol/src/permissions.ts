import { z } from 'zod';

/**
 * Granular, per-device permissions. A device can only call methods whose
 * required permission is in its grant set. Grants are chosen by the PC owner
 * when approving a pairing and can be changed or revoked at any time.
 */
export const PERMISSIONS = [
  'monitor', // read hardware stats / system info
  'power', // shutdown, restart, sleep, lock ...
  'apps', // launch/close owner-approved applications, open approved URLs
  'games', // launch/close detected or owner-added games
  'input', // remote mouse & keyboard (also needs global "allow remote input")
  'audio', // volume, mute, media keys, device selection
  'files', // transfer files inside owner-approved shared folders
  'macros', // run owner-defined macros (each step is still permission-checked)
  'screen', // view the PC screen (also needs global "allow screen viewing")
  'clipboard' // read/write the PC clipboard (text only)
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PermissionSchema = z.enum(PERMISSIONS);

/** Safe defaults pre-selected in the approval dialog. */
export const DEFAULT_GRANTS: Permission[] = ['monitor', 'apps', 'games', 'audio'];

export function isPermission(p: unknown): p is Permission {
  return typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p);
}

/**
 * Permission list as received from the PC. Unknown entries (added by a newer
 * desktop version) are dropped instead of failing, so an older phone app keeps working.
 */
export const PermissionListSchema = z
  .array(z.string().max(32))
  .max(32)
  .transform((list) => list.filter(isPermission));

export function hasPermission(grants: readonly Permission[], needed: Permission | null): boolean {
  return needed === null || grants.includes(needed);
}
