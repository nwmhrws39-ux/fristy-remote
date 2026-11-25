import { useEffect, useRef, useState } from 'react';
import { Cpu, Gauge, HardDrive, MemoryStick, MousePointer2, Network, QrCode, RefreshCw, Timer, Wifi, X } from 'lucide-react';
import type { SystemStats } from '@fristy/protocol';
import { formatBytes, formatDuration, formatPercent, formatRate, formatTemp } from '@fristy/shared/src/format';
import { invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { Badge, Button, Card, ErrorNote, Sparkline, StatusDot, Toggle } from '../components/ui';
import type { PageId } from '../App';

const HISTORY = 60;

function useLiveStats() {
  const [history, setHistory] = useState<SystemStats[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await invoke<SystemStats>('stats.get');
        if (alive) setHistory((h) => [...h.slice(-(HISTORY - 1)), s]);
      } catch {
        /* keep last values */
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return history;
}

export function Dashboard({ state, go }: { state: CoreState; go: (p: PageId) => void }) {
  const { t } = useI18n();
  const stats = useLiveStats();
  const last = stats[stats.length - 1];
  const memPct = last?.memUsed != null && last.memTotal ? (last.memUsed / last.memTotal) * 100 : null;
  const series = (f: (s: SystemStats) => number | null) => stats.map(f);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
          <p className="mt-1 text-sm text-muted">{t('app.tagline')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={state.settings.remoteEnabled && state.listening ? 'ok' : 'neutral'}>
            <StatusDot online={state.settings.remoteEnabled && state.listening} />
            {state.settings.remoteEnabled ? (state.listening ? t('common.online') : t('common.error')) : t('common.disabled')}
          </Badge>
          {state.settings.relayEnabled && <Badge tone={state.relay.status === 'connected' ? 'accent' : 'warn'}>Relay · {state.relay.status}</Badge>}
        </div>
      </header>

      {!state.platform.supported && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          Running on {state.platform.name}. PC control features need Windows 10/11 – they will report "unsupported" on this system.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <PairingCard state={state} />
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric icon={Cpu} label={t('dash.cpu')} value={formatPercent(last?.cpuLoad)} sub={`${t('dash.temp')} ${formatTemp(last?.cpuTemp)}`} series={series((s) => s.cpuLoad)} />
            <Metric icon={Gauge} label={t('dash.gpu')} value={formatPercent(last?.gpuLoad)} sub={`${t('dash.temp')} ${formatTemp(last?.gpuTemp)}`} series={series((s) => s.gpuLoad)} color="#5B8CFF" />
            <Metric icon={MemoryStick} label={t('dash.ram')} value={formatPercent(memPct)} sub={`${formatBytes(last?.memUsed)} / ${formatBytes(last?.memTotal)}`} series={series((s) => (s.memUsed != null && s.memTotal ? (s.memUsed / s.memTotal) * 100 : null))} color="#3EDC8F" />
            <Metric icon={Network} label={t('dash.network')} value={formatRate(last?.netRx)} sub={`↑ ${formatRate(last?.netTx)}`} series={series((s) => s.netRx)} max={Math.max(1, ...stats.map((s) => s.netRx ?? 0))} color="#FFB547" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SmallStat icon={HardDrive} label={t('dash.storage')} value={`${formatBytes(last?.diskFree)}`} />
            <SmallStat icon={Timer} label={t('dash.uptime')} value={formatDuration(last?.uptime)} />
            <SmallStat icon={Wifi} label={t('dash.game')} value={last?.runningGame?.name ?? '—'} />
          </div>
          <SessionsCard state={state} go={go} />
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, series, max = 100, color }: { icon: typeof Cpu; label: string; value: string; sub: string; series: (number | null)[]; max?: number; color?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card p-4 fade-in">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <Icon className="size-4" style={{ color: color ?? 'var(--fr-accent)' }} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">
        <span dir="ltr">{value}</span>
      </div>
      <div className="text-xs text-faint">
        <bdi>{sub}</bdi>
      </div>
      <div className="mt-2">
        <Sparkline values={series} max={max} height={44} color={color} />
      </div>
    </div>
  );
}

function SmallStat({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-line bg-card p-4">
      <div className="rounded-2xl bg-accent/15 p-2.5 text-accent">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate font-semibold">
          <bdi>{value}</bdi>
        </div>
      </div>
    </div>
  );
}

function PairingCard({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { busy, error, run } = useAction();
  const pairing = state.pairing;
  const lastText = useRef<string | null>(null);

  useEffect(() => {
    if (!pairing) {
      setQr(null);
      lastText.current = null;
      return;
    }
    if (pairing.qrText === lastText.current) return;
    lastText.current = pairing.qrText;
    void invoke<string>('pairing.qr', { text: pairing.qrText }).then(setQr);
  }, [pairing?.qrText]);

  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const remaining = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  useEffect(() => {
    if (pairing && remaining === 0) void invoke('state.get');
  }, [remaining, pairing]);

  return (
    <Card title={t('pair.title')} className="relative overflow-hidden">
      {!state.settings.remoteEnabled ? (
        <p className="text-sm text-muted">{t('settings.remoteAccess')} – {t('common.disabled')}</p>
      ) : pairing && remaining > 0 ? (
        <div className="flex flex-col items-center text-center">
          <div className="rounded-3xl bg-white p-3 glow">{qr ? <img src={qr} alt="Pairing QR code" className="size-56" /> : <div className="size-56" />}</div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">{t('pair.manual')}</div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.2em]" dir="ltr">
            {pairing.code.slice(0, 4)}-{pairing.code.slice(4)}
          </div>
          <div className="mt-2 text-xs text-muted">{t('pair.expiresIn', { s: remaining })}</div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${(remaining / 120) * 100}%` }} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void run(() => invoke('pairing.create'))}>
              {t('pair.refresh')}
            </Button>
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => void invoke('pairing.cancel')}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-4 rounded-3xl bg-accent/15 p-5 text-accent">
            <QrCode className="size-12" />
          </div>
          <p className="mb-5 max-w-xs text-sm text-muted">Open FRISTY Remote on your phone and scan the code. You will confirm the new device here before it gets any access.</p>
          <Button busy={busy} onClick={() => void run(() => invoke('pairing.create'))}>
            {t('pair.newCode')}
          </Button>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-3 text-[11px] text-faint" dir="ltr">
        PC key {state.fingerprint}
      </div>
    </Card>
  );
}

function SessionsCard({ state, go }: { state: CoreState; go: (p: PageId) => void }) {
  const { t } = useI18n();
  return (
    <Card
      title={`${t('devices.connected')} (${state.sessions.length})`}
      action={
        <Button variant="ghost" onClick={() => go('devices')}>
          {t('nav.devices')}
        </Button>
      }
    >
      <Toggle
        checked={state.settings.inputEnabled}
        onChange={(v) => void invoke('settings.update', { inputEnabled: v })}
        label={t('settings.remoteInput')}
        description={t('input.emergency')}
      />
      <Toggle
        checked={state.settings.screenEnabled}
        onChange={(v) => void invoke('settings.update', { screenEnabled: v })}
        label={t('settings.screenView')}
        description={t('settings.screenViewHint')}
      />
      <div className="mt-3 divide-y divide-line">
        {state.sessions.length === 0 && <p className="py-3 text-sm text-muted">{t('devices.none')}</p>}
        {state.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-3">
            <StatusDot online />
            <div className="flex-1">
              <div className="text-sm font-semibold">{s.deviceName}</div>
              <div className="text-xs text-muted" dir="ltr">
                {s.kind === 'relay' ? 'Internet relay' : s.remote} · {new Date(s.connectedAt).toLocaleTimeString()}
              </div>
            </div>
            {s.lastInputAt && Date.now() - s.lastInputAt < 5000 && (
              <Badge tone="bad">
                <MousePointer2 className="size-3" /> {t('status.inputActive')}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
