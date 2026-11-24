import type { KeyName } from '@fristy/protocol';

/** Windows virtual-key codes for the whitelisted key names. */
export const VK: Record<KeyName, number> = {
  enter: 0x0d,
  escape: 0x1b,
  backspace: 0x08,
  tab: 0x09,
  space: 0x20,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageUp: 0x21,
  pageDown: 0x22,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
  win: 0x5b,
  printScreen: 0x2c,
  capsLock: 0x14,
  volumeMute: 0xad,
  volumeDown: 0xae,
  volumeUp: 0xaf,
  mediaNext: 0xb0,
  mediaPrevious: 0xb1,
  mediaStop: 0xb2,
  mediaPlayPause: 0xb3,
  ...(Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [c, c.toUpperCase().charCodeAt(0)])) as Record<
    'a',
    number
  >),
  ...(Object.fromEntries('0123456789'.split('').map((c) => [c, c.charCodeAt(0)])) as Record<'0', number>)
} as Record<KeyName, number>;

export const MODIFIER_VK = { ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5b } as const;
