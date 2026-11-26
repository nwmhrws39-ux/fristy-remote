import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Crown, Laptop, LogOut, Smartphone } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { adminLogout, getOverview, getStats, setConfig, updateInstall, type Overview, type OwnerStats } from '../admin/owner';
import { Button, Card, ErrorText, Input, Muted, Pill, Title } from '../components/ui';

const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🌐');

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function AdminScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { c, t, row } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockMessage, setLockMessage] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [minVersion, setMinVersion] = useState('');
  const [stats, setStats] = useState<OwnerStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getOverview();
      setData(d);
      setLockMessage(d.config.lockMessage);
      setAnnouncement(d.config.announcement);
      setMinVersion(d.config.minVersion);
      setStats(await getStats(14).catch(() => null));
      setError(null);
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

  const save = async (patch: Partial<Overview['config']>) => {
    try {
      const r = await setConfig(patch);
      setData((d) => (d ? { ...d, config: r.config } : d));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const online = data?.installs.filter((i) => i.online).length ?? 0;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.accent} />}>
      <Title sub={data ? `${data.installs.length} · ${online} ${t('owner.onlineNow')}` : undefined}>{t('owner.panel')}</Title>
      <ErrorText>{error}</ErrorText>

      {data && (
        <>
          {stats && <StatsCard stats={stats} />}

          <Card style={{ borderColor: data.config.locked ? c.danger : c.cardBorder }}>
            <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>🔒 {t('owner.lockAll')}</Text>
              <Switch value={data.config.locked} onValueChange={(v) => void save({ locked: v, lockMessage })} trackColor={{ true: c.danger, false: c.cardBorder }} thumbColor="#fff" />
            </View>
            <Input style={{ marginTop: spacing.md }} value={lockMessage} onChangeText={setLockMessage} placeholder={t('owner.lockMessage')} maxLength={300} onEndEditing={() => void save({ lockMessage })} />
          </Card>

          <Card title={`📢 ${t('owner.announcement')}`}>
            <Input value={announcement} onChangeText={setAnnouncement} multiline maxLength={500} style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }} />
            <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.sm }}>
              <Button style={{ flex: 1 }} label={t('common.save')} onPress={() => void save({ announcement: announcement.trim() })} />
              <Button style={{ flex: 1 }} variant="ghost" label={t('common.delete')} onPress={() => (setAnnouncement(''), void save({ announcement: '' }))} />
            </View>
          </Card>

          <Card title={`⬆️ ${t('owner.minVersion')}`}>
            <View style={{ flexDirection: row, gap: spacing.sm }}>
              <Input style={{ flex: 1 }} value={minVersion} onChangeText={setMinVersion} placeholder="0.2.0" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
              <Button label={t('common.save')} disabled={!/^(\d+\.\d+\.\d+)?$/.test(minVersion.trim())} onPress={() => void save({ minVersion: minVersion.trim() })} />
            </View>
          </Card>

          <Card title={`👥 ${t('owner.users')}`}>
            {data.installs.map((i) => (
              <View key={i.id} style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i.online ? c.success : c.textFaint }} />
                {i.kind === 'pc' ? <Laptop color={c.textMuted} size={20} /> : <Smartphone color={c.textMuted} size={20} />}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: row, alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>
                      {i.name}
                    </Text>
                    {i.admin && <Crown color={c.warning} size={14} />}
                    {i.id === data.you && <Pill tone="accent">you</Pill>}
                  </View>
                  <Text style={{ color: c.textFaint, fontSize: font.tiny }}>
                    {flag(i.country)} {i.platform} · v{i.appVersion} · {i.online ? t('owner.onlineNow') : `${t('owner.lastSeen')} ${ago(i.lastSeen)}`}
                  </Text>
                </View>
                {i.id !== data.you && !i.admin && (
                  <Pressable
                    onPress={() => void updateInstall(i.id, { blocked: !i.blocked }).then(load, (e: Error) => setError(e.message))}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, backgroundColor: i.blocked ? c.success + '22' : c.danger + '22' }}
                  >
                    <Text style={{ color: i.blocked ? c.success : c.danger, fontWeight: '700', fontSize: font.small }}>{i.blocked ? t('owner.unblock') : t('owner.block')}</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {data.installs.length === 0 && <Muted>{t('common.none')}</Muted>}
          </Card>
        </>
      )}

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

/** Daily users for the last 14 days (phones + PCs stacked) and app versions. */
function StatsCard({ stats }: { stats: OwnerStats }) {
  const { c, t, row } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...stats.days.map((d) => d.users));
  const vMax = Math.max(1, ...stats.versions.map((v) => v.users));
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
