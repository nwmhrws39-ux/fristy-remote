import { useState } from 'react';
import { CheckCircle2, CircleAlert, Info, Stethoscope, XCircle } from 'lucide-react';
import { LANGUAGES } from '@fristy/shared/src/i18n';
import { ACCENTS, type AccentName } from '@fristy/ui';
import { errorText, invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { Button, Card, ErrorNote, Field, Toggle, cx, inputClass } from '../components/ui';
import type { DiagnosticCheck } from '../../main/diagnostics';

type S = CoreState['settings'];

export function Settings({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const s = state.settings;
  const act = useAction();
  const set = (patch: Partial<S>) => void act.run(() => invoke('settings.update', patch));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t('nav.settings')}</h1>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={t('settings.theme')}>
          <div className="space-y-4">
            <Field label={t('settings.language')}>
              <div className="flex gap-2">
                {LANGUAGES.map((l) => (
                  <button key={l.code} onClick={() => set({ language: l.code })} className={cx('flex-1 rounded-2xl border px-3 py-2 text-sm', s.language === l.code ? 'border-accent bg-accent/15' : 'border-line text-muted')}>
                    {l.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('settings.theme')}>
              <div className="flex gap-2">
                {(['dark', 'light'] as const).map((th) => (
                  <button key={th} onClick={() => set({ theme: th })} className={cx('flex-1 rounded-2xl border px-3 py-2 text-sm', s.theme === th ? 'border-accent bg-accent/15' : 'border-line text-muted')}>
                    {t(th === 'dark' ? 'settings.dark' : 'settings.light')}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('settings.accent')}>
              <div className="flex gap-3">
                {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
                  <button key={a} aria-label={a} onClick={() => set({ accent: a })} className={cx('size-9 rounded-full border-2 transition', s.accent === a ? 'scale-110 border-fg' : 'border-transparent')} style={{ background: ACCENTS[a][500] }} />
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card title={t('settings.remoteAccess')}>
          <Toggle checked={s.remoteEnabled} onChange={(v) => set({ remoteEnabled: v })} label={t('settings.remoteAccess')} description="When off, the PC accepts no connections at all." />
          <Toggle checked={s.inputEnabled} onChange={(v) => set({ inputEnabled: v })} label={t('settings.remoteInput')} description={t('input.emergency')} />
          <Toggle checked={s.screenEnabled} onChange={(v) => set({ screenEnabled: v })} label={t('settings.screenView')} description={t('settings.screenViewHint')} />
          <Toggle checked={s.startWithWindows} onChange={(v) => set({ startWithWindows: v })} label={t('settings.startWithWindows')} />
          <Toggle checked={s.startMinimized} onChange={(v) => set({ startMinimized: v })} label="Start minimized to tray" />
          <div className="mt-3 max-w-[200px]">
            <Field label={t('settings.port')}>
              <input type="number" min={1024} max={65535} className={inputClass} defaultValue={s.port} onBlur={(e) => Number(e.target.value) !== s.port && set({ port: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <RelayCard state={state} set={set} />

        <Card title={t('settings.notifications')}>
          <p className="mb-4 text-sm text-muted">Alert thresholds sent to phones (each phone chooses which notifications it shows).</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="CPU °C">
              <input type="number" min={40} max={110} className={inputClass} defaultValue={s.alertCpuTemp} onBlur={(e) => set({ alertCpuTemp: Number(e.target.value) })} />
            </Field>
            <Field label="GPU °C">
              <input type="number" min={40} max={110} className={inputClass} defaultValue={s.alertGpuTemp} onBlur={(e) => set({ alertGpuTemp: Number(e.target.value) })} />
            </Field>
            <Field label="Free disk %">
              <input type="number" min={1} max={50} className={inputClass} defaultValue={s.alertLowStoragePct} onBlur={(e) => set({ alertLowStoragePct: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <LauncherCard s={s} set={set} />
        <Diagnostics />
        {state.owner?.enabled && <OwnerKey admin={state.owner.admin} />}
      </div>
    </div>
  );
}

function RelayCard({ state, set }: { state: CoreState; set: (p: Partial<S>) => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(state.settings.relayUrl);
  return (
    <Card title={t('settings.relay')}>
      <p className="mb-3 text-sm text-muted">
        Reach this PC from other networks through a FRISTY relay server you trust. Traffic stays end-to-end encrypted – the relay cannot read or send commands. LAN mode never needs a relay or an account.
      </p>
      <Field label={t('settings.relayUrl')}>
        <input className={inputClass} dir="ltr" placeholder="wss://relay.example.com/relay" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== state.settings.relayUrl && set({ relayUrl: url.trim() })} />
      </Field>
      <Toggle checked={state.settings.relayEnabled} disabled={!state.settings.relayUrl} onChange={(v) => set({ relayEnabled: v })} label={t('common.enabled')} description={`Status: ${state.relay.status}${state.relay.error && state.relay.status !== 'connected' ? ` – ${state.relay.error}` : ''}`} />
    </Card>
  );
}

function LauncherCard({ s, set }: { s: S; set: (p: Partial<S>) => void }) {
  const [token, setToken] = useState('');
  const [result, setResult] = useState<string | null>(null);
  return (
    <Card title="FRISTY Launcher integration">
      <p className="mb-3 text-sm text-muted">Optional. Imports games from FRISTY Launcher through its authenticated local API. FRISTY Remote works without it.</p>
      <Toggle checked={s.launcherIntegration} onChange={(v) => set({ launcherIntegration: v })} label="Enable integration" />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Local API URL">
          <input className={inputClass} dir="ltr" defaultValue={s.launcherApiUrl} onBlur={(e) => set({ launcherApiUrl: e.target.value.trim() })} />
        </Field>
        <Field label="API token">
          <input className={inputClass} type="password" value={token} placeholder="Stored with Windows encryption" onChange={(e) => setToken(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" disabled={!token} onClick={() => void invoke('launcher.setToken', { token }).then(() => (setToken(''), setResult('Token saved')))}>
          Save token
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void invoke<{ app: string; version: string }>('launcher.test').then(
              (h) => setResult(`Connected to ${h.app} ${h.version}`),
              (e) => setResult(errorText(e))
            )
          }
        >
          Test connection
        </Button>
      </div>
      {result && <p className="mt-2 text-xs text-muted">{result}</p>}
    </Card>
  );
}

function Diagnostics() {
  const { t } = useI18n();
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [details, setDetails] = useState(false);
  const act = useAction();
  const icon = { ok: CheckCircle2, warn: CircleAlert, error: XCircle, info: Info };
  const color = { ok: 'text-ok', warn: 'text-warn', error: 'text-bad', info: 'text-muted' };
  return (
    <Card title={t('settings.diagnostics')} className="lg:col-span-2" action={<Button icon={<Stethoscope className="size-4" />} busy={act.busy} onClick={() => void act.run(() => invoke<DiagnosticCheck[]>('diagnostics.run')).then((c) => c && setChecks(c))}>Run</Button>}>
      {!checks && <p className="text-sm text-muted">Checks the control server, network, identity storage, relay and hardware sensors.</p>}
      <div className="divide-y divide-line">
        {checks?.map((c) => {
          const I = icon[c.status];
          return (
            <div key={c.id} className="flex items-start gap-3 py-2.5">
              <I className={cx('mt-0.5 size-4 shrink-0', color[c.status])} />
              <div className="w-44 shrink-0 text-sm font-semibold">{c.label}</div>
              <div className="text-sm text-muted">
                {c.detail}
                {details && c.technical && (
                  <div className="mt-0.5 font-mono text-xs text-faint" dir="ltr">
                    {c.technical}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {checks && (
        <button className="mt-3 text-xs font-semibold text-accent" onClick={() => setDetails((d) => !d)}>
          {details ? t('common.hideDetails') : t('common.showDetails')}
        </button>
      )}
      <ErrorNote>{act.error}</ErrorNote>
    </Card>
  );
}

/** Small, unobtrusive admin entry: the code is verified by the owner service, never in the app. */
function OwnerKey({ admin }: { admin: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const act = useAction();
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-faint lg:col-span-2">
      {admin && <span className="rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent">{t('owner.adminActive')}</span>}
      <button aria-label={t('owner.code')} className="rounded-lg p-1.5 opacity-40 hover:opacity-100" onClick={() => setOpen((v) => !v)}>
        🔑
      </button>
      {open && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => invoke('owner.login', { code })).then((r) => {
              setCode('');
              if (r !== undefined) {
                setOk(true);
                setOpen(false);
              }
            });
          }}
        >
          <input type="password" autoComplete="off" className={`${inputClass} h-8 w-44`} placeholder={t('owner.code')} value={code} onChange={(e) => setCode(e.target.value)} />
          <Button className="h-8" busy={act.busy} disabled={!code}>
            {t('owner.enter')}
          </Button>
        </form>
      )}
      {act.error && <span className="text-bad">{act.error}</span>}
      {ok && <span className="text-ok">{t('owner.adminOk')}</span>}
    </div>
  );
}
