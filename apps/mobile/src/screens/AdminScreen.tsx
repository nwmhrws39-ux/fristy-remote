import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, Crown, FlaskConical, Laptop, LogOut, Mail, Smartphone, Trash2 } from 'lucide-react-native';
import { REQUIRED_SERVER_VERSION, type StringKey } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import {
  adminLogout,
  createInvite,
  deleteInvite,
  getLog,
  getOverview,
  getStats,
  notifyTest,
  releaseToEveryone,
  setConfig,
  updateInstall,
  type AdminConfig,
  type InstallInfo,
  type LogEntry,
  type Overview,
  type OwnerStats,
  type AttemptLimit,
  getLimits,
  getServerVersion,
  resetLimit,
  serverOutdated
} from '../admin/owner';
import { Button, Card, ErrorText, Input, Muted, Pill, Title } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';

const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🌐');

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const when = (ts: number, lang: string) =>
  new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : undefined, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

type Tab = 'stats' | 'users' | 'controls' | 'log';
type Save = (p: Partial<AdminConfig>) => Promise<void>;

export function AdminScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { c, t, row } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [limits, setLimits] = useState<AttemptLimit[]>([]);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  useEffect(() => {
    void getServerVersion().then(setServerVersion);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('stats');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getOverview());
      setError(null);
      void getStats(14).then(setStats, () => setStats(null));
      void getLimits().then((r) => setLimits(r.limits), () => setLimits([]));
      void getLog().then((r) => setLog(r.entries), () => setLog([]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const save: Save = async (patch) => {
    try {
      const r = await setConfig(patch);
      setData((d) => (d ? { ...d, config: r.config } : d));
      setError(null);
      void getLog().then((x) => setLog(x.entries), () => setLog([]));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const act = (p: Promise<unknown>) => void p.then(load, (e: Error) => setError(e.message));

  const online = data?.installs.filter((i) => i.online).length ?? 0;
  const pending = (data?.installs.filter((i) => i.pending).length ?? 0) + limits.length;
  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'stats', label: '📊' },
    { id: 'users', label: `👥`, badge: pending },
    { id: 'controls', label: '⚙️' },
    { id: 'log', label: '📜' }
  ];

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.accent} />}
    >
      <Title sub={data ? `${data.installs.length} ${t('owner.users')} · ${online} ${t('owner.onlineNow')}` : undefined}>{t('owner.panel')}</Title>
      <View style={{ flexDirection: row, backgroundColor: c.card, borderRadius: radius.lg, padding: 4, marginBottom: spacing.md, borderWidth: 1, borderColor: c.cardBorder }}>
        {TABS.map((x) => (
          <Pressable
            key={x.id}
            onPress={() => setTab(x.id)}
            style={{ flex: 1, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: tab === x.id ? c.accent : 'transparent' }}
          >
            <Text style={{ fontSize: 18 }}>{x.label}</Text>
            {!!x.badge && (
              <View style={{ backgroundColor: c.warning, borderRadius: 99, paddingHorizontal: 6 }}>
                <Text style={{ color: '#000', fontSize: 11, fontWeight: '800' }}>{x.badge}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      {serverVersion !== null && serverVersion >= 0 && serverVersion < REQUIRED_SERVER_VERSION ? (
        <View style={{ backgroundColor: c.warning + '22', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ color: c.warning, fontWeight: '700' }}>⚠️ {t('owner.serverOld', { have: serverVersion || '≤2', need: REQUIRED_SERVER_VERSION })}</Text>
        </View>
      ) : (serverOutdated || /not found|error 404/i.test(error ?? '')) && (
        <View style={{ backgroundColor: c.warning + '22', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ color: c.warning, fontWeight: '700' }}>⚠️ {t('owner.serverOutdated')}</Text>
        </View>
      )}
      <ErrorText>{/not found|error 404/i.test(error ?? '') ? null : error}</ErrorText>

      <ErrorBoundary key={tab}>
      {data && tab === 'stats' && (stats ? <StatsCard stats={stats} /> : <Muted>{serverOutdated ? '—' : '…'}</Muted>)}
      {data && tab === 'users' && <LimitsCard limits={limits} act={act} />}
      {data && tab === 'users' && <UsersCard data={data} act={act} limited={new Set(limits.map((l) => l.installId ?? ''))} />}
      {data && tab === 'controls' && <Controls data={data} save={save} act={act} />}
      {tab === 'log' && <LogCard entries={log} />}
      </ErrorBoundary>

      <Button
        variant="ghost"
        icon={<LogOut color={c.text} size={16} />}
        label={t('owner.logout')}
        onPress={() =>
          void adminLogout().then(() => {
            onSignedOut();
          })
        }
      />
    </ScrollView>
  );
}

/* ---------------- users ---------------- */

/** Devices that typed a wrong admin/invite code too often – the owner decides whether to lift it. */
function LimitsCard({ limits, act }: { limits: AttemptLimit[]; act: (p: Promise<unknown>) => void }) {
  const { c, t, row } = useApp();
  if (!limits.length) return null;
  return (
    <Card title={`⛔ ${t('owner.limits')}`} style={{ borderColor: c.warning }}>
      <Muted>{t('owner.limitsHint')}</Muted>
      {limits.map((l) => (
        <View key={l.id} style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, backgroundColor: c.bgElevated, borderRadius: radius.md, padding: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '700' }}>
              {l.name ?? t('owner.unknownDevice')} · <Text style={{ color: l.kind === 'admin' ? c.danger : c.warning }}>{l.kind === 'admin' ? t('owner.limitAdmin') : t('owner.limitInvite')}</Text>
            </Text>
            <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{t('owner.limitResetsIn', { n: l.attempts, m: Math.max(1, Math.ceil((l.resetAt - Date.now()) / 60_000)) })}</Text>
          </View>
          <Chip label={t('owner.limitReset')} tone={c.success} onPress={() => act(resetLimit(l.installId ? { installId: l.installId } : { id: l.id }))} />
        </View>
      ))}
    </Card>
  );
}

function UsersCard({ data, act, limited }: { data: Overview; act: (p: Promise<unknown>) => void; limited: Set<string> }) {
  const { c, t, row } = useApp();
  const [messageFor, setMessageFor] = useState<InstallInfo | null>(null);
  const sorted = [...data.installs].sort((a, b) => Number(b.pending) - Number(a.pending));
  return (
    <Card title={`👥 ${t('owner.users')}`}>
      {sorted.map((i) => {
        const self = i.id === data.you;
        return (
          <View key={i.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder, backgroundColor: i.pending ? c.warning + '11' : 'transparent' }}>
            <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i.online ? c.success : c.textFaint }} />
              {i.kind === 'pc' ? <Laptop color={c.textMuted} size={20} /> : <Smartphone color={c.textMuted} size={20} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: row, alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>
                    {i.name}
                  </Text>
                  {i.admin && <Crown color={c.warning} size={14} />}
                  {self && <Pill tone="accent">you</Pill>}
                  {i.pending && <Pill tone="warn">{t('owner.pending')}</Pill>}
                  {i.beta && !i.admin && <Pill tone="accent">β</Pill>}
                  {i.blocked && <Pill tone="bad">{t('owner.block')}</Pill>}
                  {limited.has(i.id) && <Pill tone="warn">⛔</Pill>}
                </View>
                <Text style={{ color: c.textFaint, fontSize: font.tiny }}>
                  {flag(i.country)} {i.platform} · v{i.appVersion} · {i.online ? t('owner.onlineNow') : `${t('owner.lastSeen')} ${ago(i.lastSeen)}`}
                </Text>
                {!!i.message && (
                  <Text style={{ color: c.accent, fontSize: font.tiny }} numberOfLines={1}>
                    ✉️ {i.message}
                  </Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: row, gap: 8, marginTop: 8, marginStart: 40, flexWrap: 'wrap' }}>
              {i.pending && <Chip label={`✓ ${t('owner.approve')}`} tone={c.success} onPress={() => act(updateInstall(i.id, { approve: true }))} />}
              <Chip icon={<Mail color={c.textMuted} size={14} />} label={t('owner.messageTo')} onPress={() => setMessageFor(i)} />
              {!i.admin && <Chip icon={<FlaskConical color={i.beta ? c.accent : c.textMuted} size={14} />} label="β" active={i.beta} onPress={() => act(updateInstall(i.id, { beta: !i.beta }))} />}
              {!self && !i.admin && (
                <Chip label={i.blocked ? t('owner.unblock') : t('owner.block')} tone={i.blocked ? c.success : c.danger} onPress={() => act(updateInstall(i.id, { blocked: !i.blocked }))} />
              )}
              {!self && !i.admin && (
                <Chip
                  icon={<Trash2 color={c.textMuted} size={14} />}
                  label=""
                  onPress={() =>
                    Alert.alert(t('owner.remove'), i.name, [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('owner.remove'), style: 'destructive', onPress: () => act(updateInstall(i.id, { remove: true })) }
                    ])
                  }
                />
              )}
            </View>
          </View>
        );
      })}
      {data.installs.length === 0 && <Muted>{t('common.none')}</Muted>}
      <MessageDialog install={messageFor} onClose={() => setMessageFor(null)} onSend={(text) => messageFor && act(updateInstall(messageFor.id, { message: text }))} />
    </Card>
  );
}

function Chip({ label, icon, tone, active, onPress }: { label: string; icon?: React.ReactNode; tone?: string; active?: boolean; onPress: () => void }) {
  const { c } = useApp();
  const color = tone ?? (active ? c.accent : c.textMuted);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        height: 30,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? c.accent : c.cardBorder,
        backgroundColor: pressed ? c.accentSoft : tone ? tone + '18' : 'transparent'
      })}
    >
      {icon}
      {!!label && <Text style={{ color, fontWeight: '700', fontSize: font.tiny }}>{label}</Text>}
    </Pressable>
  );
}

function MessageDialog({ install, onClose, onSend }: { install: InstallInfo | null; onClose: () => void; onSend: (text: string) => void }) {
  const { c, t, row } = useApp();
  const [text, setText] = useState('');
  useEffect(() => setText(install?.message ?? ''), [install]);
  return (
    <Modal transparent visible={!!install} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: spacing.xl }}>
        <View style={{ backgroundColor: c.bgElevated, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: c.cardBorder }}>
          <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '800' }}>
            ✉️ {t('owner.messageTo')} – {install?.name}
          </Text>
          <Input value={text} onChangeText={setText} multiline maxLength={300} autoFocus style={{ height: 100, paddingTop: 12, textAlignVertical: 'top' }} />
          <View style={{ flexDirection: row, gap: spacing.sm }}>
            {!!install?.message && <Button style={{ flex: 1 }} variant="ghost" label={t('common.delete')} onPress={() => (onSend(''), onClose())} />}
            <Button style={{ flex: 1 }} label={t('owner.send')} disabled={!text.trim()} onPress={() => (onSend(text.trim()), onClose())} />
          </View>
          <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- controls ---------------- */

function Controls({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { c, t, row } = useApp();
  const [lockMessage, setLockMessage] = useState(data.config.lockMessage);
  const [announcement, setAnnouncement] = useState(data.config.announcement);
  const [minVersion, setMinVersion] = useState(data.config.minVersion);
  return (
    <>
      <Card style={{ borderColor: data.config.locked ? c.danger : c.cardBorder }}>
        <SwitchRow label={`🔒 ${t('owner.lockAll')}`} value={data.config.locked} danger onChange={(v) => void save({ locked: v, lockMessage })} />
        <Input style={{ marginTop: spacing.md }} value={lockMessage} onChangeText={setLockMessage} placeholder={t('owner.lockMessage')} maxLength={300} onEndEditing={() => void save({ lockMessage })} />
      </Card>

      <Card title={`📢 ${t('owner.announcement')}`}>
        <Input value={announcement} onChangeText={setAnnouncement} multiline maxLength={500} style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }} />
        <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.sm }}>
          <Button style={{ flex: 1 }} label={t('common.save')} onPress={() => void save({ announcement: announcement.trim() })} />
          <Button style={{ flex: 1 }} variant="ghost" label={t('common.delete')} onPress={() => (setAnnouncement(''), void save({ announcement: '' }))} />
        </View>
      </Card>

      <MaintenanceCard config={data.config} save={save} />
      <InvitesCard data={data} save={save} act={act} />
      <BetaCard data={data} save={save} act={act} />
      <NotifyCard config={data.config} save={save} />

      <Card title={`⬆️ ${t('owner.minVersion')}`}>
        <View style={{ flexDirection: row, gap: spacing.sm }}>
          <Input style={{ flex: 1 }} value={minVersion} onChangeText={setMinVersion} placeholder="0.2.0" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
          <Button label={t('common.save')} disabled={!/^(\d+\.\d+\.\d+)?$/.test(minVersion.trim())} onPress={() => void save({ minVersion: minVersion.trim() })} />
        </View>
      </Card>
    </>
  );
}

function SwitchRow({ label, value, onChange, danger, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean; hint?: string }) {
  const { c, row } = useApp();
  return (
    <View>
      <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>{label}</Text>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: danger ? c.danger : c.accent, false: c.cardBorder }} thumbColor="#fff" />
      </View>
      {!!hint && <Text style={{ color: c.textMuted, fontSize: font.tiny, marginTop: 4 }}>{hint}</Text>}
    </View>
  );
}

function Seg<T extends string | number>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c, row } = useApp();
  return (
    <View style={{ flexDirection: row, flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <Pressable
          key={String(o.v)}
          onPress={() => onChange(o.v)}
          style={{ paddingHorizontal: 12, height: 32, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: value === o.v ? c.accent : c.bgElevated }}
        >
          <Text style={{ color: value === o.v ? '#fff' : c.text, fontWeight: '700', fontSize: font.small }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Start time presets (no date picker needed). */
function startPresets(lang: string): { v: number; label: string }[] {
  const now = Date.now();
  const at = (h: number, addDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const tonight = at(22, 0) > now ? at(22, 0) : at(22, 1);
  const list = [now + 60_000, now + 60 * 60_000, now + 3 * 60 * 60_000, tonight, at(22, 1) === tonight ? at(22, 2) : at(22, 1)];
  return list.map((v, i) => ({ v, label: i === 0 ? (lang === 'he' ? 'עכשיו' : 'Now') : when(v, lang) }));
}

function MaintenanceCard({ config, save }: { config: AdminConfig; save: Save }) {
  const { c, t, prefs } = useApp();
  const lang = prefs.language;
  const m = config.maintenance && config.maintenance.end > Date.now() ? config.maintenance : null;
  const [presets] = useState(() => startPresets(lang));
  const [start, setStart] = useState(presets[3]!.v);
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState('');
  const active = !!m && m.start <= Date.now();
  return (
    <Card title={`🔧 ${t('owner.maintenance')}`} style={{ borderColor: active ? c.warning : c.cardBorder }}>
      {m ? (
        <View style={{ backgroundColor: active ? c.warning + '22' : c.bgElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ color: active ? c.warning : c.text, fontWeight: '700' }}>
            {active ? t('owner.maintActive', { end: when(m.end, lang) }) : t('owner.maintUpcoming', { start: when(m.start, lang), end: when(m.end, lang) })}
          </Text>
          {!!m.message && <Muted>“{m.message}”</Muted>}
          <Button style={{ marginTop: spacing.sm }} variant="ghost" label={t('owner.maintCancel')} onPress={() => void save({ maintenance: null })} />
        </View>
      ) : (
        <Muted>{t('owner.maintNone')}</Muted>
      )}
      <Text style={{ color: c.textMuted, fontWeight: '700', fontSize: font.tiny, marginTop: spacing.sm, marginBottom: 6 }}>{t('owner.maintStart')}</Text>
      <Seg options={presets} value={start} onChange={setStart} />
      <Text style={{ color: c.textMuted, fontWeight: '700', fontSize: font.tiny, marginTop: spacing.md, marginBottom: 6 }}>{t('owner.maintDuration')}</Text>
      <Seg
        options={[15, 30, 60, 120, 240, 480].map((d) => ({ v: d, label: d < 60 ? `${d} ${t('owner.minutes')}` : `${d / 60} ${t('owner.hours')}` }))}
        value={minutes}
        onChange={setMinutes}
      />
      <Input style={{ marginTop: spacing.md }} value={message} onChangeText={setMessage} placeholder={t('owner.maintMessage')} maxLength={300} />
      <Button style={{ marginTop: spacing.sm }} label={t('owner.maintSchedule')} onPress={() => void save({ maintenance: { start, end: start + minutes * 60_000, message: message.trim() } })} />
    </Card>
  );
}

function InvitesCard({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { c, t, row } = useApp();
  const [note, setNote] = useState('');
  const [uses, setUses] = useState(1);
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <Card title={`🎟️ ${t('owner.invites')}`}>
      <SwitchRow label={t('owner.inviteRequired')} hint={t('owner.inviteHint')} value={data.config.inviteRequired} onChange={(v) => void save({ inviteRequired: v })} />
      <Input style={{ marginTop: spacing.md }} value={note} onChangeText={setNote} placeholder={t('owner.note')} maxLength={60} />
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
        <Seg options={[1, 5, 25].map((n) => ({ v: n, label: `×${n}` }))} value={uses} onChange={setUses} />
        <Button
          style={{ flex: 1 }}
          label={t('owner.createInvite')}
          onPress={() =>
            void createInvite(uses, note.trim()).then(
              (r) => {
                setFresh(r.code);
                setNote('');
                act(Clipboard.setStringAsync(r.code));
              },
              () => undefined
            )
          }
        />
      </View>
      <View style={{ marginTop: spacing.md, gap: 6 }}>
        {data.invites.map((i) => (
          <View
            key={i.code}
            style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, padding: 10, borderRadius: radius.md, backgroundColor: i.code === fresh ? c.accentSoft : c.bgElevated, opacity: i.uses >= i.maxUses ? 0.5 : 1 }}
          >
            <Text style={{ color: c.text, fontWeight: '900', letterSpacing: 2, fontSize: 16 }}>{i.code}</Text>
            <Text style={{ color: c.textMuted, fontSize: font.tiny, flex: 1 }} numberOfLines={1}>
              {i.note}
            </Text>
            <Text style={{ color: c.textFaint, fontSize: font.tiny }}>
              {i.uses}/{i.maxUses}
            </Text>
            <CopyIcon text={i.code} />
            <Pressable hitSlop={8} onPress={() => act(deleteInvite(i.code))}>
              <Trash2 color={c.textFaint} size={16} />
            </Pressable>
          </View>
        ))}
      </View>
    </Card>
  );
}

function CopyIcon({ text }: { text: string }) {
  const { c } = useApp();
  const [done, setDone] = useState(false);
  return (
    <Pressable
      hitSlop={8}
      onPress={() =>
        void Clipboard.setStringAsync(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check color={c.success} size={16} /> : <Copy color={c.textMuted} size={16} />}
    </Pressable>
  );
}

function BetaCard({ data, save, act }: { data: Overview; save: Save; act: (p: Promise<unknown>) => void }) {
  const { c, t } = useApp();
  const cfg = data.config;
  const testers = data.installs.filter((i) => i.beta && !i.admin).length;
  const newer = (a: string, b: string) => !!a && a !== b;
  const canRelease = newer(data.betaVersions.pc, cfg.stablePc) || newer(data.betaVersions.ios, cfg.stableIos);
  return (
    <Card title={`🧪 ${t('owner.beta')}`}>
      <SwitchRow label={t('owner.betaOn')} hint={t('owner.betaHint')} value={cfg.betaChannel} onChange={(v) => void save({ betaChannel: v })} />
      {cfg.betaChannel && (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <View style={{ backgroundColor: c.bgElevated, borderRadius: radius.md, padding: spacing.md }}>
            <Text style={{ color: c.text }}>{t('owner.stableNow', { pc: cfg.stablePc || '–', ios: cfg.stableIos || '–' })}</Text>
            <Text style={{ color: c.accent }}>{t('owner.betaNow', { pc: data.betaVersions.pc || '–', ios: data.betaVersions.ios || '–' })}</Text>
            <Text style={{ color: c.textFaint, fontSize: font.tiny }}>
              β {t('owner.betaTester')}: {testers}
            </Text>
          </View>
          <Button label={`🚀 ${t('owner.release')}`} disabled={!canRelease} onPress={() => act(releaseToEveryone())} />
        </View>
      )}
    </Card>
  );
}

function newTopic() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `fristy-${s}`;
}

function NotifyCard({ config, save }: { config: AdminConfig; save: Save }) {
  const { c, t, row } = useApp();
  const [sent, setSent] = useState<string | null>(null);
  return (
    <Card title={`🔔 ${t('owner.notify')}`}>
      <Muted>{t('owner.notifyHint')}</Muted>
      {config.notifyTopic ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm, backgroundColor: c.bgElevated, borderRadius: radius.md, padding: 10 }}>
            <Text style={{ color: c.text, flex: 1, fontFamily: 'Menlo' }} selectable numberOfLines={1}>
              {config.notifyTopic}
            </Text>
            <CopyIcon text={config.notifyTopic} />
          </View>
          <View style={{ flexDirection: row, gap: spacing.sm }}>
            <Button style={{ flex: 1 }} label={t('owner.notifyTest')} onPress={() => void notifyTest().then(() => setSent('✓'), (e: Error) => setSent(e.message))} />
            <Button style={{ flex: 1 }} variant="ghost" label={t('owner.notifyOff')} onPress={() => void save({ notifyTopic: '' })} />
          </View>
          {sent && <Text style={{ color: c.success }}>{sent}</Text>}
        </View>
      ) : (
        <Button style={{ marginTop: spacing.md }} label={t('owner.notifyCreate')} onPress={() => void save({ notifyTopic: newTopic() })} />
      )}
    </Card>
  );
}

/* ---------------- log ---------------- */

function LogCard({ entries }: { entries: LogEntry[] | null }) {
  const { c, t, prefs } = useApp();
  const label = (a: string) => {
    const k = `owner.act.${a}` as StringKey;
    const s = t(k);
    return s === k ? a : s;
  };
  return (
    <Card title={`📜 ${t('owner.log')}`}>
      {entries === null && <Muted>…</Muted>}
      {entries?.length === 0 && <Muted>{t('common.none')}</Muted>}
      {entries?.map((e) => (
        <View key={e.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
          <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{when(e.ts, prefs.language)}</Text>
          <Text style={{ color: e.action === 'login.failed' ? c.danger : c.text }}>
            <Text style={{ fontWeight: '800' }}>{e.actor}</Text> {label(e.action)} {!!e.target && <Text style={{ fontWeight: '800' }}>{e.target}</Text>}
          </Text>
          {!!e.detail && (
            <Text style={{ color: c.textMuted, fontSize: font.tiny }} numberOfLines={2}>
              {e.action === 'maintenance' && /^\d+-\d+$/.test(e.detail)
                ? e.detail
                    .split('-')
                    .map((x) => when(Number(x), prefs.language))
                    .join(' → ')
                : e.detail}
            </Text>
          )}
        </View>
      ))}
    </Card>
  );
}

/* ---------------- stats ---------------- */

/** Daily users for the last 14 days (phones + PCs stacked), countries and app versions. */
function StatsCard({ stats }: { stats: OwnerStats }) {
  const { c, t, row } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...stats.days.map((d) => d.users));
  const vMax = Math.max(1, ...stats.versions.map((v) => v.users));
  const cMax = Math.max(1, ...stats.countries.map((v) => v.users));
  const d = stats.days[sel ?? stats.days.length - 1];
  const tiles: [string, number][] = [
    [t('owner.total'), stats.totals.users],
    [t('owner.active7'), stats.totals.active7],
    [t('owner.active30'), stats.totals.active30]
  ];
  return (
    <Card title={`📊 ${t('owner.stats')}`}>
      <View style={{ flexDirection: row, gap: spacing.sm }}>
        {tiles.map(([label, n]) => (
          <View key={label} style={{ flex: 1, backgroundColor: c.bgElevated, borderRadius: radius.md, padding: 10 }}>
            <Text style={{ color: c.textMuted, fontSize: font.tiny }}>{label}</Text>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>{n}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: c.text, fontWeight: '700', marginTop: spacing.md }}>{t('owner.dailyUsers')}</Text>
      {d && (
        <Text style={{ color: c.textMuted, fontSize: font.tiny, marginBottom: 6 }}>
          {d.day} · {d.users} ({d.phones} 📱 · {d.pcs} 💻) · +{d.newUsers} {t('owner.newUsers')}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 3 }}>
        {stats.days.map((x, i) => (
          <Pressable key={x.day} onPress={() => setSel(i)} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', opacity: sel === null || sel === i ? 1 : 0.5 }}>
            <View style={{ height: `${(x.phones / max) * 100}%`, backgroundColor: c.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            <View style={{ height: `${(x.pcs / max) * 100}%`, backgroundColor: c.success }} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ color: c.textFaint, fontSize: 10 }}>{stats.days[0]?.day.slice(5)}</Text>
        <Text style={{ color: c.textFaint, fontSize: 10 }}>{stats.days.at(-1)?.day.slice(5)}</Text>
      </View>
      <View style={{ flexDirection: row, gap: spacing.md, marginTop: 6 }}>
        <Text style={{ color: c.accent, fontSize: font.tiny }}>■ {t('owner.phones')}</Text>
        <Text style={{ color: c.success, fontSize: font.tiny }}>■ {t('owner.pcs')}</Text>
      </View>

      <Text style={{ color: c.text, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 }}>{t('owner.countries')}</Text>
      {stats.countries.map((x) => (
        <View key={x.country ?? '-'} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 20, width: 28 }}>{flag(x.country)}</Text>
          <Text style={{ color: c.textMuted, fontSize: font.tiny, width: 24 }}>{x.country ?? '?'}</Text>
          <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.bgElevated, overflow: 'hidden' }}>
            <View style={{ width: `${(x.users / cMax) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: c.accent }} />
          </View>
          <Text style={{ color: c.textMuted, fontSize: font.tiny, width: 26, textAlign: 'right' }}>{x.users}</Text>
        </View>
      ))}

      <Text style={{ color: c.text, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 }}>{t('owner.versions')}</Text>
      {stats.versions.map((v) => (
        <View key={`${v.version}-${v.kind}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Text style={{ color: c.text, fontSize: font.tiny, width: 74 }}>
            {v.kind === 'pc' ? '💻' : '📱'} v{v.version}
          </Text>
          <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.bgElevated, overflow: 'hidden' }}>
            <View style={{ width: `${(v.users / vMax) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: v.kind === 'pc' ? c.success : c.accent }} />
          </View>
          <Text style={{ color: c.textMuted, fontSize: font.tiny, width: 26, textAlign: 'right' }}>{v.users}</Text>
        </View>
      ))}
    </Card>
  );
}
