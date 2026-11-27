import { useEffect, useState } from 'react';
import {
  AppWindow,
  Crown,
  FolderSync,
  Gamepad2,
  LayoutDashboard,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Zap
} from 'lucide-react';
import { DEFAULT_GRANTS, type Permission } from '@fristy/protocol';
import type { StringKey } from '@fristy/shared/src/i18n';
import { addressKind } from '@fristy/shared/src/wol';
import { errorText, invoke, onPairingRequest, onState, type CoreState, type PendingPairing } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';
import { Badge, Button, Logo, Modal, StatusDot, cx, inputClass } from './components/ui';
import { PermissionPicker } from './components/permissions';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Apps } from './pages/Apps';
import { Games } from './pages/Games';
import { Macros } from './pages/Macros';
import { Files } from './pages/Files';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';

const PAGES = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
  { id: 'devices', icon: Smartphone, label: 'nav.devices' },
  { id: 'games', icon: Gamepad2, label: 'nav.games' },
  { id: 'apps', icon: AppWindow, label: 'nav.apps' },
  { id: 'macros', icon: Zap, label: 'nav.macros' },
  { id: 'files', icon: FolderSync, label: 'nav.files' },
  { id: 'logs', icon: ShieldCheck, label: 'nav.logs' },
  { id: 'settings', icon: SettingsIcon, label: 'nav.settings' },
  { id: 'admin', icon: Crown, label: 'owner.panel' }
] as const;
export type PageId = (typeof PAGES)[number]['id'];

export function App() {
  const [state, setState] = useState<CoreState | null>(null);
  useEffect(() => {
    void invoke<CoreState>('state.get').then(setState);
    return onState(setState);
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.accent = state.settings.accent;
  }, [state?.settings.theme, state?.settings.accent]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Logo size={56} />
      </div>
    );
  }
  return (
    <I18nProvider lang={state.settings.language}>
      <Shell state={state} />
    </I18nProvider>
  );
}

function Shell({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [page, setPage] = useState<PageId>('dashboard');
  const [request, setRequest] = useState<PendingPairing | null>(state.pending[0] ?? null);

  useEffect(() => onPairingRequest(setRequest), []);
  useEffect(() => {
    // close the dialog if the request disappeared (timeout / phone gave up)
    if (request && !state.pending.some((p) => p.id === request.id)) setRequest(state.pending[0] ?? null);
    else if (!request && state.pending[0]) setRequest(state.pending[0]);
  }, [state.pending, request]);

  const online = state.settings.remoteEnabled && state.listening;
  const inputActive = state.sessions.some((s) => s.lastInputAt && Date.now() - s.lastInputAt < 5000);

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-e border-line bg-elevated">
        <div className="drag flex h-20 items-center gap-3 px-6">
          <Logo />
          <div>
            <div className="text-lg font-extrabold tracking-[0.18em]">FRISTY</div>
            <div className="-mt-0.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">Remote</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {PAGES.filter((p) => p.id !== 'admin' || state.owner?.enabled).map((p) => (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              className={cx(
                'flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition',
                page === p.id ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-card hover:text-fg'
              )}
            >
              <p.icon className={cx('size-[18px]', page === p.id && 'text-accent')} />
              {t(p.label as StringKey)}
              {p.id === 'devices' && state.sessions.length > 0 && (
                <span className="ms-auto rounded-full bg-accent px-2 text-[11px] font-bold text-white">{state.sessions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="m-3 rounded-2xl border border-line bg-card p-4 text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <StatusDot online={online} />
            {online ? t('common.online') : t('common.offline')}
          </div>
          <div className="mt-1 text-muted">
            {state.settings.remoteEnabled ? (state.listening ? t('status.ready') : state.listenError) : t('settings.remoteAccess') + ' · ' + t('common.disabled')}
          </div>
          {inputActive && (
            <div className="mt-2">
              <Badge tone="bad">{t('status.inputActive')}</Badge>
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="drag h-10" />
        <div className="mx-auto max-w-6xl px-8 pb-10">
          <UpdateBanner />
          <OwnerBanners state={state} />
          {page === 'dashboard' && <Dashboard state={state} go={setPage} />}
          {page === 'devices' && <Devices state={state} />}
          {page === 'games' && <Games />}
          {page === 'apps' && <Apps />}
          {page === 'macros' && <Macros />}
          {page === 'files' && <Files state={state} />}
          {page === 'logs' && <Logs />}
          {page === 'settings' && <Settings state={state} />}
          {page === 'admin' && <Admin state={state} />}
        </div>
      </main>
      <PairingRequestDialog request={request} onDone={() => setRequest(null)} />
    </div>
  );
}

function PairingRequestDialog({ request, onDone }: { request: PendingPairing | null; onDone: () => void }) {
  const { t } = useI18n();
  const [perms, setPerms] = useState<Permission[]>(DEFAULT_GRANTS);
  useEffect(() => setPerms(DEFAULT_GRANTS), [request?.id]);
  if (!request) return null;
  const deny = () => {
    void invoke('pairing.deny', { id: request.id });
    onDone();
  };
  return (
    <Modal
      open
      onClose={deny}
      title={t('pair.request')}
      footer={
        <>
          <Button variant="danger" onClick={deny}>
            {t('pair.deny')}
          </Button>
          <Button
            onClick={() => {
              void invoke('pairing.approve', { id: request.id, permissions: perms });
              onDone();
            }}
          >
            {t('pair.approve')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{t('pair.requestBody', { name: request.deviceName, platform: request.platform })}</p>
      <div className="my-5 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t('pair.verify')}</div>
        <div className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-fg" dir="ltr">
          {request.sas.slice(0, 3)} {request.sas.slice(3)}
        </div>
        <div className="mt-2 text-[11px] text-faint" dir="ltr">
          {t(`route.${addressKind(request.remote)}` as StringKey)} · key {request.fingerprint}
        </div>
      </div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('pair.grant')}</div>
      <PermissionPicker value={perms} onChange={setPerms} />
    </Modal>
  );
}

function OwnerBanners({ state }: { state: CoreState }) {
  const { t, lang } = useI18n();
  const o = state.owner;
  const [seen, setSeen] = useState(() => {
    try {
      return Number(localStorage.getItem('fristy.personalSeen') ?? 0);
    } catch {
      return 0;
    }
  });
  if (!o?.enabled) return null;
  const fmt = (ts: number) => new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' });
  const m = o.maintenance;
  const upcoming = m && !(o.locked && o.reason === 'maintenance') && m.start > Date.now() ? m : null;
  const personal = o.personal && o.personal.at > seen ? o.personal : null;
  return (
    <div className="mb-4 space-y-2">
      {o.locked && !o.admin && o.reason === 'invite' && <InviteBanner />}
      {o.locked && !o.admin && o.reason !== 'invite' && (
        <div className={cx('rounded-2xl border p-4 text-sm', o.reason === 'maintenance' ? 'border-warn/40 bg-warn/10' : 'border-bad/40 bg-bad/10')}>
          <div className={cx('font-bold', o.reason === 'maintenance' ? 'text-warn' : 'text-bad')}>
            {o.reason === 'blocked' ? t('owner.blocked') : o.reason === 'maintenance' ? `🔧 ${t('owner.maintTitle')}` : t('owner.locked')}
          </div>
          <div className="mt-1 text-muted" dir="auto">
            {o.reason === 'maintenance' && m ? `${t('owner.maintActive', { end: fmt(m.end) })}${o.message ? ` – ${o.message}` : ''}` : o.message || t('owner.lockedHint')}
          </div>
        </div>
      )}
      {upcoming && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn" dir="auto">
          🔧 {t('owner.maintUpcoming', { start: fmt(upcoming.start), end: fmt(upcoming.end) })}
          {upcoming.message && <span className="text-muted"> – {upcoming.message}</span>}
        </div>
      )}
      {personal && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm">
          <div className="flex-1" dir="auto">
            <div className="text-xs font-semibold text-accent">✉️ {t('owner.messageFromOwner')}</div>
            <div className="mt-1 text-fg">{personal.text}</div>
          </div>
          <button
            className="rounded-lg px-2 text-muted hover:text-fg"
            aria-label={t('common.close')}
            onClick={() => {
              setSeen(personal.at);
              try {
                localStorage.setItem('fristy.personalSeen', String(personal.at));
              } catch {
                /* ignore */
              }
            }}
          >
            ✕
          </button>
        </div>
      )}
      {o.announcement && (
        <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm text-fg" dir="auto">
          📢 {o.announcement}
        </div>
      )}
      {o.updateAvailable && <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{t('owner.update')}</div>}
    </div>
  );
}

/** This PC joined while the app is invite-only: enter the code from the owner. */
function InviteBanner() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void invoke('owner.redeem', { code })
          .catch((err) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="font-bold text-warn">🎟️ {t('owner.inviteTitle')}</div>
      <div className="mt-1 text-muted">{t('owner.inviteBody')}</div>
      <div className="mt-3 flex gap-2">
        <input className={cx(inputClass, 'max-w-56 font-mono uppercase tracking-widest')} dir="ltr" maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" />
        <Button busy={busy} disabled={code.trim().length < 4}>
          {t('owner.inviteEnter')}
        </Button>
      </div>
      {error && <div className="mt-2 text-bad">{error}</div>}
    </form>
  );
}

type UpdateState =
  | { status: 'disabled' }
  | { status: 'idle' | 'checking' | 'none'; current: string }
  | { status: 'available' | 'downloading'; current: string; version: string; percent: number }
  | { status: 'ready'; current: string; version: string }
  | { status: 'error'; current: string; error: string };

export function useUpdateState() {
  const [st, setSt] = useState<UpdateState>({ status: 'disabled' });
  useEffect(() => {
    void invoke<UpdateState>('update.state').then(setSt);
    return window.fristy.on('update', (d) => setSt(d as UpdateState));
  }, []);
  return st;
}

/** Mandatory update banner: shown as soon as a newer version exists. */
function UpdateBanner() {
  const { t } = useI18n();
  const st = useUpdateState();
  if (st.status !== 'available' && st.status !== 'downloading' && st.status !== 'ready') return null;
  const pct = st.status === 'ready' ? 100 : st.percent;
  return (
    <div className="mb-4 rounded-2xl border border-accent bg-accent/15 p-4 fade-in">
      <div className="flex items-center gap-4">
        <div className="flex-1 text-sm">
          <div className="font-bold">{t('update.required')}</div>
          <div className="text-muted">
            {st.status === 'ready' ? t('update.ready', { v: st.version }) : st.status === 'downloading' ? t('update.downloading', { v: st.version, p: pct }) : t('update.available', { v: st.version })}
          </div>
        </div>
        <Button disabled={st.status !== 'ready'} onClick={() => void invoke('update.install')}>
          {t('update.now')}
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
