import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  Check,
  Copy,
  Crown,
  FlaskConical,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  Megaphone,
  RefreshCw,
  ScrollText,
  Smartphone,
  Ticket,
  Trash2,
  Wrench
} from 'lucide-react';
import type { StringKey } from '@fristy/shared/src/i18n';
import { REQUIRED_SERVER_VERSION } from '@fristy/shared/src/owner-config';
import { errorText, invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { AdminStats } from './AdminStats';
import { flag } from '../lib/flag';
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, Toggle, cx, inputClass } from '../components/ui';

interface Config {
  locked: boolean;
  lockMessage: string;
  announcement: string;
  minVersion: string;
  inviteRequired: boolean;
  maintenance: { start: number; end: number; message: string } | null;
  notifyTopic: string;
  betaChannel: boolean;
  stablePc: string;
  stableIos: string;
}

interface Install {
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
  pending: boolean;
  beta: boolean;
  message: string;
}

interface Overview {
  config: Config;
  you: string;
  betaVersions: { pc: string; ios: string };
  invites: { code: string; note: string; maxUses: number; uses: number; createdAt: number }[];
  installs: Install[];
  limits: Limit[];
}

type Save = (p: Partial<Config>) => Promise<void>;

/** Fills in fields an older owner server does not send yet, so the panel never crashes. */
function normalize(o: Omit<Partial<Overview>, 'config'> & { config?: Partial<Config> }): Overview & { outdated: boolean } {
  const c: Partial<Config> = o.config ?? {};
  return {
    outdated: !Array.isArray(o.invites),
    you: o.you ?? '',
    betaVersions: { pc: o.betaVersions?.pc ?? '', ios: o.betaVersions?.ios ?? '' },
    invites: Array.isArray(o.invites) ? o.invites : [],
    limits: Array.isArray(o.limits) ? o.limits : [],
    installs: (Array.isArray(o.installs) ? o.installs : []).map((i) => ({ ...i, pending: !!i.pending, beta: !!i.beta, message: i.message ?? '' })),
    config: {
      locked: !!c.locked,
      lockMessage: c.lockMessage ?? '',
      announcement: c.announcement ?? '',
      minVersion: c.minVersion ?? '',
      inviteRequired: !!c.inviteRequired,
      maintenance: c.maintenance ?? null,
      notifyTopic: c.notifyTopic ?? '',
      betaChannel: !!c.betaChannel,
      stablePc: c.stablePc ?? '',
      stableIos: c.stableIos ?? ''
    }
  };
}

/** "not found" from the owner server means it is older than this app. */
export function friendlyOwnerError(msg: string, t: (k: StringKey) => string) {
  return /not found|error 404/i.test(msg) ? t('owner.serverOutdated') : msg;
}
type Tab = 'stats' | 'users' | 'controls' | 'log';


function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const when = (ts: number, lang: string) => new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : undefined, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Owner admin panel: sign in with the admin code, then manage everyone who uses the app. */
export function Admin({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<(Overview & { outdated: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>('stats');
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  useEffect(() => {
    void invoke<number>('owner.serverVersion').then(setServerVersion, () => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([
        invoke<Overview>('owner.overview'),
        invoke<{ limits: Limit[] }>('owner.limits').catch(() => ({ limits: [] as Limit[] }))
      ]);
      setData(normalize({ ...o, limits: l.limits }));
      setRefreshKey((k) => k + 1);
      setSignedIn(true);
      setError(null);
    } catch (e) {
      const msg = errorText(e);
      if (/not signed in|not an admin/i.test(msg)) setSignedIn(false);
      else setError(friendlyOwnerError(msg, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const save: Save = async (patch) => {
    try {
      const r = await invoke<{ config: Config }>('owner.config', patch);
      setData((d) => (d ? { ...d, config: normalize({ ...d, config: r.config }).config } : d));
      setError(null);
    } catch (e) {
      setError(friendlyOwnerError(errorText(e), t));
    }
  };
  const act = (p: Promise<unknown>) => void p.then(load, (e) => setError(friendlyOwnerError(errorText(e), t)));
  const online = data?.installs.filter((i) => i.online).length ?? 0;
  const pending = (data?.installs.filter((i) => i.pending).length ?? 0) + (data?.limits.length ?? 0);

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'stats', label: t('owner.stats') },
    { id: 'users', label: t('owner.users'), badge: pending },
    { id: 'controls', label: '⚙️' },
    { id: 'log', label: t('owner.log') }
  ];

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
              {data.config.locked && <span className="ms-2 text-bad">· 🔒 {t('owner.locked')}</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void invoke('owner.logout').then(() => setSignedIn(false))}>
            {t('owner.logout')}
          </Button>
        </div>
      </header>

      <nav className="flex gap-1 rounded-2xl border border-line bg-card p-1">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={cx('flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition', tab === x.id ? 'bg-accent text-white' : 'text-muted hover:text-fg')}
          >
            {x.label}
            {!!x.badge && <span className="rounded-full bg-warn px-1.5 text-[11px] text-black">{x.badge}</span>}
          </button>
        ))}
      </nav>

      {serverVersion !== null && serverVersion >= 0 && serverVersion < REQUIRED_SERVER_VERSION ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn" dir="auto">
          ⚠️ {t('owner.serverOld', { have: serverVersion || '≤2', need: REQUIRED_SERVER_VERSION })}
        </div>
      ) : (
        data?.outdated && <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">⚠️ {t('owner.serverOutdated')}</div>
      )}
      <ErrorNote>{error}</ErrorNote>
      {data && tab === 'stats' && <AdminStats refreshKey={refreshKey} />}
      {data && tab === 'users' && <Users data={data} act={act} />}
      {data && tab === 'controls' && <Controls data={data} save={save} act={act} />}
      {data && tab === 'log' && <Reports refreshKey={refreshKey} />}
      {data && tab === 'log' && <Log refreshKey={refreshKey} />}
    </div>
  );
}

/* ---------------- users ---------------- */

interface Limit {
  id: string;
  installId: string | null;
  name: string | null;
  kind: 'admin' | 'invite';
  attempts: number;
  resetAt: number;
}

/** Devices that typed a wrong admin/invite code too often – the owner decides whether to lift it. */
function Limits({ limits, act }: { limits: Limit[]; act: (p: Promise<unknown>) => void }) {
  const { t } = useI18n();
  if (!limits.length) return null;
  return (
    <Card className="mb-6 border-warn/50" title={`⛔ ${t('owner.limits')}`}>
      <p className="mb-3 text-sm text-muted">{t('owner.limitsHint')}</p>
      <div className="space-y-2">
        {limits.map((l) => (
          <div key={l.id} className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-semibold" dir="auto">
                {l.name ?? t('owner.unknownDevice')} <Badge tone={l.kind === 'admin' ? 'bad' : 'warn'}>{l.kind === 'admin' ? t('owner.limitAdmin') : t('owner.limitInvite')}</Badge>
              </div>
              <div className="text-xs text-faint">{t('owner.limitResetsIn', { n: l.attempts, m: Math.max(1, Math.ceil((l.resetAt - Date.now()) / 60_000)) })}</div>
            </div>
            <Button onClick={() => act(invoke('owner.limitReset', l.installId ? { installId: l.installId } : { id: l.id }))}>{t('owner.limitReset')}</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Users({ data, act }: { data: Overview; act: (p: Promise<unknown>) => void }) {
  const { t } = useI18n();
  const [messageFor, setMessageFor] = useState<Install | null>(null);
  const sorted = [...data.installs].sort((a, b) => Number(b.pending) - Number(a.pending));
  const install = (installId: string, patch: Record<string, unknown>) => act(invoke('owner.install', { installId, ...patch }));
  const limited = new Set(data.limits.map((l) => l.installId));
  return (
    <>
    <Limits limits={data.limits} act={act} />
    <Card title={`👥 ${t('owner.users')}`}>
      {data.installs.length === 0 && <Empty>{t('common.none')}</Empty>}
      <div className="divide-y divide-line">
        {sorted.map((i) => {
          const self = i.id === data.you;
          return (
            <div key={i.id} className={cx('flex items-center gap-3 py-3', i.pending && 'rounded-xl bg-warn/5 px-2')}>
              <span className={cx('size-2.5 shrink-0 rounded-full', i.online ? 'bg-ok' : 'bg-faint')} />
              {i.kind === 'pc' ? <Laptop className="size-5 shrink-0 text-muted" /> : <Smartphone className="size-5 shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="truncate" dir="auto">
                    {i.name}
                  </span>
                  {i.admin && <Crown className="size-4 text-warn" />}
                  {self && <Badge tone="accent">you</Badge>}
                  {i.pending && <Badge tone="warn">{t('owner.pending')}</Badge>}
                  {i.beta && !i.admin && <Badge tone="accent">β {t('owner.betaTester')}</Badge>}
                  {i.blocked && <Badge tone="bad">{t('owner.block')}</Badge>}
                  {limited.has(i.id) && <Badge tone="warn">⛔ {t('owner.limitBadge')}</Badge>}
                </div>
                <div className="text-xs text-faint">
                  {flag(i.country)} {i.platform} · v{i.appVersion} · {i.online ? t('owner.onlineNow') : `${t('owner.lastSeen')} ${ago(i.lastSeen)}`}
                </div>
                {i.message && (
                  <div className="mt-1 truncate text-xs text-accent" dir="auto">
                    ✉️ {i.message}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {i.pending && (
                  <Button icon={<Check className="size-4" />} onClick={() => install(i.id, { approve: true })}>
                    {t('owner.approve')}
                  </Button>
                )}
                <IconButton label={t('owner.messageTo')} onClick={() => setMessageFor(i)}>
                  <Mail className="size-4" />
                </IconButton>
                {!i.admin && (
                  <IconButton label={t('owner.betaTester')} active={i.beta} onClick={() => install(i.id, { beta: !i.beta })}>
                    <FlaskConical className="size-4" />
                  </IconButton>
                )}
                {!self && !i.admin && (
                  <Button variant={i.blocked ? 'ghost' : 'danger'} onClick={() => install(i.id, { blocked: !i.blocked })}>
                    {i.blocked ? t('owner.unblock') : t('owner.block')}
                  </Button>
                )}
                {!self && !i.admin && (
                  <IconButton label={t('owner.remove')} onClick={() => confirm(`${t('owner.remove')}: ${i.name}?`) && install(i.id, { remove: true })}>
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <MessageDialog install={messageFor} onClose={() => setMessageFor(null)} onSend={(text) => messageFor && install(messageFor.id, { message: text })} />
    </Card>
    </>
  );
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx('rounded-xl border p-2 transition', active ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:bg-elevated hover:text-fg')}
    >
      {children}
    </button>
  );
}

function MessageDialog({ install, onClose, onSend }: { install: Install | null; onClose: () => void; onSend: (text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  useEffect(() => setText(install?.message ?? ''), [install]);
  return (
    <Modal
      open={!!install}
      onClose={onClose}
      title={`✉️ ${t('owner.messageTo')} – ${install?.name ?? ''}`}
      footer={
        <>
          {install?.message && (
            <Button variant="ghost" onClick={() => (onSend(''), onClose())}>
              {t('common.delete')}
            </Button>
          )}
          <Button disabled={!text.trim()} onClick={() => (onSend(text.trim()), onClose())}>
            {t('owner.send')}
          </Button>
        </>
      }
    >
      <textarea className={cx(inputClass, 'h-28 py-2')} value={text} maxLength={300} autoFocus dir="auto" onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

/* ---------------- controls ---------------- */

function Controls({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { t } = useI18n();
  const [lockMessage, setLockMessage] = useState(data.config.lockMessage);
  const [announcement, setAnnouncement] = useState(data.config.announcement);
  const [minVersion, setMinVersion] = useState(data.config.minVersion);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className={cx(data.config.locked && 'border-bad')} title={`🔒 ${t('owner.lockAll')}`}>
        <Toggle checked={data.config.locked} onChange={(v) => void save({ locked: v, lockMessage })} label={data.config.locked ? t('owner.locked') : t('common.disabled')} />
        <Field label={t('owner.lockMessage')}>
          <input className={inputClass} value={lockMessage} maxLength={300} dir="auto" onChange={(e) => setLockMessage(e.target.value)} onBlur={() => void save({ lockMessage })} />
        </Field>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Megaphone className="size-4" /> {t('owner.announcement')}</span>}>
        <textarea className={cx(inputClass, 'h-20 py-2')} value={announcement} maxLength={500} onChange={(e) => setAnnouncement(e.target.value)} dir="auto" />
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

      <Maintenance config={data.config} save={save} />
      <Invites data={data} save={save} act={act} />
      <Beta data={data} save={save} act={act} />
      <Notifications config={data.config} save={save} />
    </div>
  );
}

const DURATIONS = [15, 30, 60, 120, 240, 480];

function localInput(ts: number) {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function tonightAt22() {
  const d = new Date();
  d.setHours(22, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function Maintenance({ config, save }: { config: Config; save: Save }) {
  const { t, lang } = useI18n();
  const m = config.maintenance && config.maintenance.end > Date.now() ? config.maintenance : null;
  const [start, setStart] = useState(localInput(tonightAt22()));
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState('');
  const active = !!m && m.start <= Date.now();
  const startTs = new Date(start).getTime();
  return (
    <Card className={cx(active && 'border-warn')} title={<span className="flex items-center gap-2"><Wrench className="size-4" /> {t('owner.maintenance')}</span>}>
      {m ? (
        <div className={cx('mb-4 rounded-xl p-3 text-sm', active ? 'bg-warn/15 text-warn' : 'bg-elevated')}>
          {active ? t('owner.maintActive', { end: when(m.end, lang) }) : t('owner.maintUpcoming', { start: when(m.start, lang), end: when(m.end, lang) })}
          {m.message && <div className="mt-1 text-muted" dir="auto">“{m.message}”</div>}
          <Button className="mt-3" variant="ghost" onClick={() => void save({ maintenance: null })}>
            {t('owner.maintCancel')}
          </Button>
        </div>
      ) : (
        <p className="mb-3 text-sm text-faint">{t('owner.maintNone')}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('owner.maintStart')}>
          <input type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('owner.maintDuration')}>
          <select className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} ${t('owner.minutes')}` : `${d / 60} ${t('owner.hours')}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t('owner.maintMessage')}>
        <input className={inputClass} value={message} maxLength={300} dir="auto" onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Button className="mt-3" disabled={!Number.isFinite(startTs)} onClick={() => void save({ maintenance: { start: startTs, end: startTs + minutes * 60_000, message: message.trim() } })}>
        {t('owner.maintSchedule')}
      </Button>
    </Card>
  );
}

function Invites({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { t } = useI18n();
  const [uses, setUses] = useState(1);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <Card title={<span className="flex items-center gap-2"><Ticket className="size-4" /> {t('owner.invites')}</span>}>
      <Toggle checked={data.config.inviteRequired} onChange={(v) => void save({ inviteRequired: v })} label={t('owner.inviteRequired')} description={t('owner.inviteHint')} />
      <div className="mt-4 flex items-end gap-2">
        <Field label={t('owner.note')}>
          <input className={inputClass} value={note} maxLength={60} dir="auto" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t('owner.maxUses')}>
          <input type="number" min={1} max={1000} className={cx(inputClass, 'w-20')} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
        </Field>
        <Button
          className="mb-0.5 whitespace-nowrap"
          onClick={() =>
            void invoke<{ code: string }>('owner.inviteCreate', { maxUses: uses, note: note.trim() }).then((r) => {
              setFresh(r.code);
              setNote('');
              act(Promise.resolve());
            })
          }
        >
          {t('owner.createInvite')}
        </Button>
      </div>
      <div className="mt-3 space-y-1.5">
        {data.invites.map((i) => (
          <div key={i.code} className={cx('flex items-center gap-3 rounded-xl px-3 py-2', i.code === fresh ? 'bg-accent/15' : 'bg-elevated', i.uses >= i.maxUses && 'opacity-50')}>
            <span className="font-mono text-base font-bold tracking-widest" dir="ltr">
              {i.code}
            </span>
            <span className="flex-1 truncate text-xs text-muted" dir="auto">
              {i.note}
            </span>
            <span className="text-xs text-faint">
              {i.uses}/{i.maxUses}
            </span>
            <CopyButton text={i.code} />
            <IconButton label={t('common.delete')} onClick={() => act(invoke('owner.inviteDelete', { code: i.code }))}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Beta({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { t } = useI18n();
  const c = data.config;
  const testers = data.installs.filter((i) => i.beta && !i.admin).length;
  const newer = (a: string, b: string) => !!a && a !== b;
  const canRelease = newer(data.betaVersions.pc, c.stablePc) || newer(data.betaVersions.ios, c.stableIos);
  return (
    <Card title={<span className="flex items-center gap-2"><FlaskConical className="size-4" /> {t('owner.beta')}</span>}>
      <Toggle checked={c.betaChannel} onChange={(v) => void save({ betaChannel: v })} label={t('owner.betaOn')} description={t('owner.betaHint')} />
      {c.betaChannel && (
        <div className="mt-4 space-y-2 text-sm">
          <div className="rounded-xl bg-elevated p-3" dir="ltr">
            <div>{t('owner.stableNow', { pc: c.stablePc || '–', ios: c.stableIos || '–' })}</div>
            <div className="text-accent">{t('owner.betaNow', { pc: data.betaVersions.pc || '–', ios: data.betaVersions.ios || '–' })}</div>
            <div className="mt-1 text-xs text-faint">
              β {t('owner.betaTester')}: {testers}
            </div>
          </div>
          <Button disabled={!canRelease} onClick={() => act(invoke('owner.release'))}>
            🚀 {t('owner.release')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function newTopic() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `fristy-${Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;
}

function Notifications({ config, save }: { config: Config; save: Save }) {
  const { t } = useI18n();
  const [sent, setSent] = useState<string | null>(null);
  return (
    <Card title={<span className="flex items-center gap-2"><Bell className="size-4" /> {t('owner.notify')}</span>}>
      <p className="text-sm text-muted">{t('owner.notifyHint')}</p>
      {config.notifyTopic ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2">
            <span className="flex-1 truncate font-mono text-sm" dir="ltr">
              {config.notifyTopic}
            </span>
            <CopyButton text={config.notifyTopic} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void invoke('owner.notifyTest').then(() => setSent('✓'), (e) => setSent(errorText(e)))}>{t('owner.notifyTest')}</Button>
            <Button variant="ghost" onClick={() => void save({ notifyTopic: '' })}>
              {t('owner.notifyOff')}
            </Button>
            {sent && <span className="self-center text-sm text-ok">{sent}</span>}
          </div>
        </div>
      ) : (
        <Button className="mt-4" onClick={() => void save({ notifyTopic: newTopic() })}>
          {t('owner.notifyCreate')}
        </Button>
      )}
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={done ? t('owner.copied') : t('owner.copy')}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

/* ---------------- log ---------------- */

interface LogEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export function actionLabel(t: (k: StringKey) => string, action: string): string {
  const key = `owner.act.${action}` as StringKey;
  const s = t(key);
  return s === key ? action : s;
}

/** Maintenance entries store "start-end" timestamps; show them in local time. */
function logDetail(e: LogEntry, lang: string) {
  const m = /^(\d+)-(\d+)$/.exec(e.detail);
  return e.action === 'maintenance' && m ? `${when(Number(m[1]), lang)} → ${when(Number(m[2]), lang)}` : e.detail;
}

function Log({ refreshKey }: { refreshKey: number }) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<{ entries: LogEntry[] }>('owner.log').then(
      (r) => setEntries(r.entries),
      (e) => setError(friendlyOwnerError(errorText(e), t))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  return (
    <Card title={<span className="flex items-center gap-2"><ScrollText className="size-4" /> {t('owner.log')}</span>}>
      <ErrorNote>{error}</ErrorNote>
      {entries?.length === 0 && <Empty>{t('common.none')}</Empty>}
      <div className="divide-y divide-line">
        {entries?.map((e) => (
          <div key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
            <span className="w-36 shrink-0 text-xs text-faint">{when(e.ts, lang)}</span>
            <span className={cx('min-w-0 flex-1', e.action === 'login.failed' && 'text-bad')} dir="auto">
              <b>{e.actor}</b> {actionLabel(t, e.action)} {e.target && <b>{e.target}</b>}
              {e.detail && <span className="ms-2 text-xs text-muted">{logDetail(e, lang)}</span>}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- reports ---------------- */

interface Report {
  id: number;
  ts: number;
  installId: string | null;
  name: string | null;
  category: string;
  message: string;
  contact: string;
  status: string;
}

function Reports({ refreshKey }: { refreshKey: number }) {
  const { t, lang } = useI18n();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    invoke<{ reports: Report[] }>('owner.reports').then(
      (r) => setReports(r.reports),
      (e) => setError(friendlyOwnerError(errorText(e), t))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [refreshKey, load]);
  const open = reports?.filter((r) => r.status === 'open').length ?? 0;
  return (
    <Card className={cx('mb-6', open > 0 && 'border-warn/60')} title={<span className="flex items-center gap-2">🚩 {t('owner.reports')} {open > 0 && <Badge tone="warn">{open}</Badge>}</span>}>
      <ErrorNote>{error}</ErrorNote>
      {reports?.length === 0 && <p className="text-sm text-faint">{t('owner.noReports')}</p>}
      <div className="space-y-2">
        {reports?.map((r) => (
          <div key={r.id} className={cx('rounded-xl bg-elevated p-3 text-sm', r.status !== 'open' && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={r.category === 'vulnerability' || r.category.startsWith('unauthorized') ? 'bad' : 'neutral'}>{t(`privacy.cat.${r.category}` as StringKey)}</Badge>
              <span className="text-xs text-faint">{when(r.ts, lang)}</span>
              <span className="text-xs text-muted">{r.name ?? (r.installId ? r.installId.slice(0, 10) : 'web')}</span>
              {r.status === 'open' ? (
                <Button className="ms-auto" variant="ghost" onClick={() => void invoke('owner.reportResolve', { id: r.id }).then(load)}>
                  {t('owner.resolve')}
                </Button>
              ) : (
                <span className="ms-auto text-xs text-ok">✓ {t('owner.reportResolved')}</span>
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap" dir="auto">
              {r.message}
            </p>
            {r.contact && (
              <p className="mt-1 text-xs text-muted" dir="auto">
                ✉️ {r.contact}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- sign in ---------------- */

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
            // login resolves with no value, so map success to `true` explicitly
            void act.run(() => invoke('owner.login', { code }).then(() => true)).then((ok) => {
              setCode('');
              if (ok) onDone();
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
