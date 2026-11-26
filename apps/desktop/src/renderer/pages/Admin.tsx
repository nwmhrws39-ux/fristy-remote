import { useCallback, useEffect, useState } from 'react';
import { Crown, KeyRound, Laptop, LogOut, Megaphone, RefreshCw, Smartphone } from 'lucide-react';
import { errorText, invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { Badge, Button, Card, Empty, ErrorNote, Field, Toggle, cx, inputClass } from '../components/ui';

interface Overview {
  config: { locked: boolean; lockMessage: string; announcement: string; minVersion: string };
  you: string;
  installs: {
    id: string;
    name: string;
    kind: 'phone' | 'pc';
    platform: string;
    appVersion: string;
    country: string | null;
    lastSeen: number;
    online: boolean;
    blocked: boolean;
    admin: boolean;
  }[];
}

const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🌐');

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Owner admin panel: sign in with the admin code, then manage everyone who uses the app. */
export function Admin({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await invoke<Overview>('owner.overview'));
      setSignedIn(true);
      setError(null);
    } catch (e) {
      const msg = errorText(e);
      if (/not signed in|not an admin/i.test(msg)) setSignedIn(false);
      else setError(msg);
    }
  }, []);

  useEffect(() => {
    void invoke<boolean>('owner.hasToken').then((has) => (has ? load() : setSignedIn(false)));
  }, [load]);
  useEffect(() => {
    if (!signedIn) return;
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [signedIn, load]);

  if (!state.owner?.enabled) {
    return (
      <Card>
        <Empty>The owner service is not configured in this build (docs/ADMIN.md).</Empty>
      </Card>
    );
  }
  if (signedIn === false) return <SignIn onDone={() => void load()} />;

  const save = async (patch: Partial<Overview['config']>) => {
    try {
      const r = await invoke<{ config: Overview['config'] }>('owner.config', patch);
      setData((d) => (d ? { ...d, config: r.config } : d));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const online = data?.installs.filter((i) => i.online).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <Crown className="size-7 text-warn" /> {t('owner.panel')}
          </h1>
          {data && (
            <p className="mt-1 text-sm text-muted">
              {data.installs.length} {t('owner.users')} · {online} {t('owner.onlineNow')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
            ↻
          </Button>
          <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void invoke('owner.logout').then(() => setSignedIn(false))}>
            {t('owner.logout')}
          </Button>
        </div>
      </header>
      <ErrorNote>{error}</ErrorNote>
      {data && <AdminBody data={data} save={save} reload={load} onError={setError} />}
    </div>
  );
}

function AdminBody({ data, save, reload, onError }: { data: Overview; save: (p: Partial<Overview['config']>) => Promise<void>; reload: () => Promise<void>; onError: (e: string) => void }) {
  const { t } = useI18n();
  const [lockMessage, setLockMessage] = useState(data.config.lockMessage);
  const [announcement, setAnnouncement] = useState(data.config.announcement);
  const [minVersion, setMinVersion] = useState(data.config.minVersion);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className={cx(data.config.locked && 'border-bad')} title={`🔒 ${t('owner.lockAll')}`}>
        <Toggle checked={data.config.locked} onChange={(v) => void save({ locked: v, lockMessage })} label={data.config.locked ? t('owner.locked') : t('common.disabled')} />
        <Field label={t('owner.lockMessage')}>
          <input className={inputClass} value={lockMessage} maxLength={300} onChange={(e) => setLockMessage(e.target.value)} onBlur={() => void save({ lockMessage })} />
        </Field>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Megaphone className="size-4" /> {t('owner.announcement')}</span>}>
        <textarea className={cx(inputClass, 'h-24 py-2')} value={announcement} maxLength={500} onChange={(e) => setAnnouncement(e.target.value)} dir="auto" />
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void save({ announcement: announcement.trim() })}>{t('common.save')}</Button>
          <Button variant="ghost" onClick={() => (setAnnouncement(''), void save({ announcement: '' }))}>
            {t('common.delete')}
          </Button>
        </div>
        <div className="mt-4">
          <Field label={t('owner.minVersion')}>
            <div className="flex gap-2">
              <input className={inputClass} dir="ltr" placeholder="0.2.20" value={minVersion} onChange={(e) => setMinVersion(e.target.value)} />
              <Button disabled={!/^(\d+\.\d+\.\d+)?$/.test(minVersion.trim())} onClick={() => void save({ minVersion: minVersion.trim() })}>
                {t('common.save')}
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card title={`👥 ${t('owner.users')}`} className="lg:col-span-2">
        {data.installs.length === 0 && <Empty>{t('common.none')}</Empty>}
        <div className="divide-y divide-line">
          {data.installs.map((i) => (
            <div key={i.id} className="flex items-center gap-3 py-3">
              <span className={cx('size-2.5 rounded-full', i.online ? 'bg-ok' : 'bg-faint')} />
              {i.kind === 'pc' ? <Laptop className="size-5 text-muted" /> : <Smartphone className="size-5 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="truncate" dir="auto">
                    {i.name}
                  </span>
                  {i.admin && <Crown className="size-4 text-warn" />}
                  {i.id === data.you && <Badge tone="accent">you</Badge>}
                  {i.blocked && <Badge tone="bad">{t('owner.block')}</Badge>}
                </div>
                <div className="text-xs text-faint">
                  {flag(i.country)} {i.platform} · v{i.appVersion} · {i.online ? t('owner.onlineNow') : `${t('owner.lastSeen')} ${ago(i.lastSeen)}`}
                </div>
              </div>
              {i.id !== data.you && !i.admin && (
                <Button
                  variant={i.blocked ? 'ghost' : 'danger'}
                  onClick={() =>
                    void invoke('owner.install', { installId: i.id, blocked: !i.blocked }).then(reload, (e) => onError(errorText(e)))
                  }
                >
                  {i.blocked ? t('owner.unblock') : t('owner.block')}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const act = useAction();
  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card>
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 rounded-3xl bg-accent/15 p-4 text-accent">
            <KeyRound className="size-8" />
          </div>
          <h1 className="text-2xl font-bold">{t('owner.panel')}</h1>
          <p className="mt-1 text-sm text-muted">{t('owner.code')}</p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => invoke('owner.login', { code })).then((r) => {
              setCode('');
              if (r !== undefined) onDone();
            });
          }}
        >
          <input type="password" autoComplete="off" autoFocus className={inputClass} placeholder="••••••••" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button className="w-full" busy={act.busy} disabled={!code}>
            {t('owner.enter')}
          </Button>
        </form>
        <ErrorNote>{act.error}</ErrorNote>
      </Card>
    </div>
  );
}
