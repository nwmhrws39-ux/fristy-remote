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
  'screen' // remote desktop viewing (not implemented in v0.1)
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PermissionSchema = z.enum(PERMISSIONS);

/** Safe defaults pre-selected in the approval dialog. */
export const DEFAULT_GRANTS: Permission[] = ['monitor', 'apps', 'games', 'audio'];

export function hasPermission(grants: readonly Permission[], needed: Permission | null): boolean {
  return needed === null || grants.includes(needed);
}
