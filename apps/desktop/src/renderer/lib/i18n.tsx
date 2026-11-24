import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { isRtl, translate, type Language, type StringKey } from '@fristy/shared/src/i18n';

interface I18n {
  lang: Language;
  rtl: boolean;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n>({ lang: 'en', rtl: false, t: (k) => translate('en', k) });

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const rtl = isRtl(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [lang, rtl]);
  return <Ctx.Provider value={{ lang, rtl, t: (k, v) => translate(lang, k, v) }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
