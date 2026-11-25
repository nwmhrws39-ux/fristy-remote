import { ScrollView, Text, View } from 'react-native';
import { Activity, Cpu, Gamepad2, Gauge, HardDrive, MemoryStick, Network, Timer, Zap } from 'lucide-react-native';
import type { SystemStats } from '@fristy/protocol';
import { formatBytes, formatDuration, formatPercent, formatRate, formatTemp } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { useConnection } from '../connection/hooks';
import { Card, Muted, NotAllowed, Pill, Sparkline, StatusDot } from '../components/ui';

export function DashboardScreen() {
  const { c, t, row, align } = useApp();
  const s = useConnection();
  const last: SystemStats | undefined = s.stats[s.stats.length - 1];
  const online = s.status === 'online';
  const canMonitor = !!s.accepted?.permissions.includes('monitor');
  const series = (f: (x: SystemStats) => number | null) => s.stats.map(f);
  const memPct = last?.memUsed != null && last.memTotal ? (last.memUsed / last.memTotal) * 100 : null;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Card style={{ borderColor: online ? c.accent + '66' : c.cardBorder }}>
        <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }}>
          <StatusDot online={online} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: font.h1, fontWeight: '800', textAlign: align }}>{s.host?.name ?? '—'}</Text>
            <Muted>
              {online
                ? `${t('common.online')} · ${s.route === 'relay' ? 'Internet relay' : s.route === 'tailscale' ? 'Tailscale' : 'LAN'}`
                : s.status === 'unauthorized'
                  ? s.error ?? ''
                  : `${t('common.connecting')} ${s.error ? `(${s.error})` : ''}`}
            </Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{t('dash.latency')}</Text>
            <Text style={{ color: s.latency == null ? c.textFaint : s.latency < 60 ? c.success : s.latency < 150 ? c.warning : c.danger, fontWeight: '800', fontSize: font.h2 }}>
              {s.latency == null ? 'N/A' : `${s.latency} ms`}
            </Text>
          </View>
        </View>
      </Card>

      {online && !canMonitor && <NotAllowed permission="monitor" />}

      {canMonitor && (
        <>
          <View style={{ flexDirection: row, gap: spacing.md }}>
            <Metric icon={Cpu} label={t('dash.cpu')} value={formatPercent(last?.cpuLoad)} sub={`${t('dash.temp')} ${formatTemp(last?.cpuTemp)}`} series={series((x) => x.cpuLoad)} />
            <Metric icon={Gauge} label={t('dash.gpu')} value={formatPercent(last?.gpuLoad)} sub={`${t('dash.temp')} ${formatTemp(last?.gpuTemp)}`} series={series((x) => x.gpuLoad)} color="#5B8CFF" />
          </View>
          <View style={{ flexDirection: row, gap: spacing.md }}>
            <Metric
              icon={MemoryStick}
              label={t('dash.ram')}
              value={formatPercent(memPct)}
              sub={`${formatBytes(last?.memUsed)} / ${formatBytes(last?.memTotal)}`}
              series={series((x) => (x.memUsed != null && x.memTotal ? (x.memUsed / x.memTotal) * 100 : null))}
              color="#3EDC8F"
            />
            <Metric
              icon={Network}
              label={t('dash.network')}
              value={formatRate(last?.netRx)}
              sub={`↑ ${formatRate(last?.netTx)}`}
              series={series((x) => x.netRx)}
              max={Math.max(1, ...s.stats.map((x) => x.netRx ?? 0))}
              color="#FFB547"
            />
          </View>
          <Card>
            <Row icon={HardDrive} label={t('dash.storage')} value={`${formatBytes(last?.diskFree)} / ${formatBytes(last?.diskTotal)}`} />
            <Row icon={Timer} label={t('dash.uptime')} value={formatDuration(last?.uptime)} />
            <Row icon={Gamepad2} label={t('dash.game')} value={last?.runningGame?.name ?? '—'} />
            <Row icon={Zap} label="GPU" value={last?.gpuName ?? 'N/A'} />
          </Card>
          {!last && (
            <View style={{ alignItems: 'center', padding: spacing.lg }}>
              <Activity color={c.textFaint} />
              <Muted center>{t('common.loading')}</Muted>
            </View>
          )}
        </>
      )}
      {s.accepted && (
        <Card title={t('devices.permissions')}>
          <View style={{ flexDirection: row, flexWrap: 'wrap', gap: 6 }}>
            {s.accepted.permissions.map((p) => (
              <Pill key={p} tone="accent">
                {t(`perm.${p}` as never)}
              </Pill>
            ))}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}

function Metric({ icon: Icon, label, value, sub, series, max = 100, color }: { icon: typeof Cpu; label: string; value: string; sub: string; series: (number | null)[]; max?: number; color?: string }) {
  const { c, row } = useApp();
  return (
    <Card style={{ flex: 1, padding: spacing.md }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: 6 }}>
        <Icon size={15} color={color ?? c.accent} />
        <Text style={{ color: c.textMuted, fontSize: font.tiny, fontWeight: '800', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      </View>
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{sub}</Text>
      <View style={{ marginTop: 8, borderRadius: radius.sm, overflow: 'hidden' }}>
        <Sparkline values={series} max={max} color={color} />
      </View>
    </Card>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  const { c, row } = useApp();
  return (
    <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 10 }}>
      <View style={{ backgroundColor: c.accentSoft, padding: 8, borderRadius: radius.sm }}>
        <Icon size={18} color={c.accent} />
      </View>
      <Text style={{ color: c.textMuted, flex: 1 }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

