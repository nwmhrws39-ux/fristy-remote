import { en, type StringKey } from './en';
import { he } from './he';

export type Language = 'en' | 'he';
export type { StringKey };

export const LANGUAGES: { code: Language; label: string; rtl: boolean }[] = [
  { code: 'en', label: 'English', rtl: false },
  { code: 'he', label: 'עברית', rtl: true }
];

const dictionaries: Record<Language, Record<StringKey, string>> = { en, he };

export function isRtl(lang: Language): boolean {
  return lang === 'he';
}

export function translate(lang: Language, key: StringKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
