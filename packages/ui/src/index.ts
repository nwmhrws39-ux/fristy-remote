/**
 * FRISTY design tokens – the single source of truth for both apps.
 * Desktop consumes them through CSS variables (theme.css), mobile through this module.
 */

export const ACCENTS = {
  purple: { 400: '#B794FF', 500: '#9B6BFF', 600: '#7C4DFF', 700: '#6236E0' },
  violet: { 400: '#D08CFF', 500: '#BB5BFF', 600: '#A23BF0', 700: '#8424CC' },
  blue: { 400: '#8AB4FF', 500: '#5B8CFF', 600: '#3B6BF0', 700: '#2A50C8' },
  pink: { 400: '#FF8AD0', 500: '#FF5BB8', 600: '#E83E9C', 700: '#C42A80' },
  green: { 400: '#7BF0B4', 500: '#3EDC8F', 600: '#22B872', 700: '#178F58' }
} as const;
export type AccentName = keyof typeof ACCENTS;

export interface Palette {
  bg: string;
  bgElevated: string;
  card: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  textFaint: string;
  success: string;
  warning: string;
  danger: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
}

export function palette(mode: 'dark' | 'light', accent: AccentName = 'purple'): Palette {
  const a = ACCENTS[accent];
  if (mode === 'dark') {
    return {
      bg: '#07070B',
      bgElevated: '#0E0E15',
      card: '#14141D',
      cardBorder: '#24243A',
      text: '#F4F2FF',
      textMuted: '#A9A6C2',
      textFaint: '#6D6A85',
      success: '#3EDC8F',
      warning: '#FFB547',
      danger: '#FF5470',
      accent: a[500],
      accentStrong: a[600],
      accentSoft: a[500] + '26'
    };
  }
  return {
    bg: '#F5F4FA',
    bgElevated: '#FFFFFF',
    card: '#FFFFFF',
    cardBorder: '#E3E1EF',
    text: '#14121F',
    textMuted: '#5C5970',
    textFaint: '#8E8BA3',
    success: '#169C5F',
    warning: '#B86E00',
    danger: '#D42A47',
    accent: a[600],
    accentStrong: a[700],
    accentSoft: a[600] + '1F'
  };
}

export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { title: 28, h1: 22, h2: 18, body: 15, small: 13, tiny: 11 } as const;

/** Colors allowed for macro buttons. */
export const MACRO_COLORS = ['#9B6BFF', '#5B8CFF', '#3EDC8F', '#FFB547', '#FF5470', '#FF5BB8', '#22D3EE'] as const;
/** Icon names allowed for macro buttons (lucide icon names, available in both apps). */
export const MACRO_ICONS = ['gamepad-2', 'briefcase', 'music', 'radio', 'moon', 'zap', 'monitor', 'coffee', 'film', 'code'] as const;
export type MacroIcon = (typeof MACRO_ICONS)[number];
