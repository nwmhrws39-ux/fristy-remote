import { useEffect, useState } from 'react';
import {
  AppWindow,
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
import { invoke, onPairingRequest, onState, type CoreState, type PendingPairing } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';
import { Badge, Button, Logo, Modal, StatusDot, cx } from './components/ui';
import { PermissionPicker } from './components/permissions';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Apps } from './pages/Apps';
import { Games } from './pages/Games';
import { Macros } from './pages/Macros';
import { Files } from './pages/Files';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';

const PAGES = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
  { id: 'devices', icon: Smartphone, label: 'nav.devices' },
  { id: 'games', icon: Gamepad2, label: 'nav.games' },
  { id: 'apps', icon: AppWindow, label: 'nav.apps' },
  { id: 'macros', icon: Zap, label: 'nav.macros' },
  { id: 'files', icon: FolderSync, label: 'nav.files' },
  { id: 'logs', icon: ShieldCheck, label: 'nav.logs' },
  { id: 'settings', icon: SettingsIcon, label: 'nav.settings' }
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
          {PAGES.map((p) => (
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
          {page === 'dashboard' && <Dashboard state={state} go={setPage} />}
          {page === 'devices' && <Devices state={state} />}
          {page === 'games' && <Games />}
          {page === 'apps' && <Apps />}
          {page === 'macros' && <Macros />}
          {page === 'files' && <Files state={state} />}
          {page === 'logs' && <Logs />}
          {page === 'settings' && <Settings state={state} />}
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
