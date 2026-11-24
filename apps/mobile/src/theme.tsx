import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isRtl, translate, type StringKey } from '@fristy/shared';
import { palette, type Palette } from '@fristy/ui';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from './store/prefs';

interface AppCtx {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  c: Palette;
  t: (k: StringKey, v?: Record<string, string | number>) => string;
  rtl: boolean;
  /** flexDirection for horizontal rows that should mirror in RTL */
  row: 'row' | 'row-reverse';
  align: 'left' | 'right';
  ready: boolean;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadPrefs().then((p) => {
      setState(p);
      setReady(true);
    });
  }, []);
  const value = useMemo<AppCtx>(() => {
    const rtl = isRtl(prefs.language);
    return {
      prefs,
      setPrefs: (patch) =>
        setState((prev) => {
          const next = { ...prev, ...patch };
          void savePrefs(next);
          return next;
        }),
      c: palette(prefs.theme, prefs.accent),
      t: (k, v) => translate(prefs.language, k, v),
      rtl,
      row: rtl ? 'row-reverse' : 'row',
      align: rtl ? 'right' : 'left',
      ready
    };
  }, [prefs, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}
