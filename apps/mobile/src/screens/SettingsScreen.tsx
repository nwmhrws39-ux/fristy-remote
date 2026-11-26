import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Monitor, Plus, Trash2 } from 'lucide-react-native';
import { LANGUAGES, addressKind, decodeBase64, fingerprint } from '@fristy/shared';
import { ACCENTS, font, radius, spacing, type AccentName } from '@fristy/ui';
import { useApp } from '../theme';
import { connection, type ProbeResult } from '../connection/manager';
import { ownerEnabled } from '../admin/owner';
import { currentVersion } from '../admin/updates';
import { AdminKey, useOwner } from '../admin/OwnerUi';
import { useConnection } from '../connection/hooks';
import { forgetHost, loadHosts, type PairedHost } from '../store/hosts';
import { getIdentity } from '../store/secure';
import type { NotificationPrefs } from '../store/prefs';
import { Button, Card, ConfirmDialog, Input, Muted, Title } from '../components/ui';

const NOTIF_LABELS: Record<keyof NotificationPrefs, string> = {
  startup: 'notif.startup',
  shutdown: 'notif.shutdown',
  cpuTemp: 'notif.cpuTemp',
  gpuTemp: 'notif.gpuTemp',
  lowStorage: 'notif.lowStorage',
  gameLaunched: 'notif.gameLaunched',
  transferComplete: 'notif.transferComplete',
  unauthorizedAttempt: 'notif.unauthorized',
  deviceDisconnected: 'notif.disconnected'
};

export function SettingsScreen({ onAddComputer, onHostsChanged, onOpenAdmin }: { onAddComputer: () => void; onHostsChanged: () => void; onOpenAdmin: () => void }) {
  const { c, t, row, prefs, setPrefs } = useApp();
  const conn = useConnection();
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [forget, setForget] = useState<PairedHost | null>(null);
  const [myKey, setMyKey] = useState('');
  const [probe, setProbe] = useState<ProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [details, setDetails] = useState(false);
  const owner = useOwner();
  useEffect(() => {
    void loadHosts().then(setHosts);
    void getIdentity().then((k) => setMyKey(fingerprint(k.publicKey)));
  }, [conn.host?.pk]);

  const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ color: c.text, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.cardBorder }} thumbColor="#fff" />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Title>{t('nav.settings')}</Title>
      {ownerEnabled && (
        <Card title={`👑 ${t('owner.panel')}`}>
          {owner.admin ? (
            <Button label={t('owner.panel')} onPress={onOpenAdmin} />
          ) : (
            <AdminKey label={t('owner.code')} onSuccess={onOpenAdmin} />
          )}
        </Card>
      )}

      <Card title={t('devices.title')} right={<Pressable onPress={onAddComputer} accessibilityLabel={t('pair.title')}><Plus color={c.accent} size={22} /></Pressable>}>
        {hosts.map((h) => (
          <View key={h.pk} style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 10 }}>
            <Monitor color={conn.host?.pk === h.pk ? c.accent : c.textMuted} size={22} />
            <Pressable style={{ flex: 1 }} onPress={() => void connection.connect(h)}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{h.name}</Text>
              <Muted>
                {conn.host?.pk === h.pk
                  ? conn.status === 'online'
                    ? `${t('common.online')} · ${t(conn.route === 'relay' ? 'route.relay' : conn.route === 'tailscale' ? 'route.remote' : 'route.home')}`
                    : t('common.connecting')
                  : t('common.offline')}
              </Muted>
            </Pressable>
            <Pressable onPress={() => setForget(h)} hitSlop={8} accessibilityLabel={t('settings.forget')}>
              <Trash2 color={c.danger} size={18} />
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title={t('settings.language')}>
        <View style={{ flexDirection: row, gap: spacing.sm }}>
          {LANGUAGES.map((l) => (
            <Pressable key={l.code} onPress={() => setPrefs({ language: l.code })} style={{ flex: 1, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: prefs.language === l.code ? c.accent : c.cardBorder, alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card title={t('settings.theme')}>
        <View style={{ flexDirection: row, gap: spacing.sm, marginBottom: spacing.md }}>
          {(['dark', 'light'] as const).map((th) => (
            <Pressable key={th} onPress={() => setPrefs({ theme: th })} style={{ flex: 1, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: prefs.theme === th ? c.accent : c.cardBorder, alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{t(th === 'dark' ? 'settings.dark' : 'settings.light')}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: c.textMuted, fontSize: font.small, marginBottom: spacing.sm }}>{t('settings.accent')}</Text>
        <View style={{ flexDirection: row, gap: spacing.md }}>
          {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
            <Pressable key={a} onPress={() => setPrefs({ accent: a })} accessibilityLabel={a} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: ACCENTS[a][500], borderWidth: 3, borderColor: prefs.accent === a ? c.text : 'transparent' }} />
          ))}
        </View>
      </Card>

      <Card title={t('settings.sensitivity')}>
        <Toggle label="Natural scrolling" value={prefs.naturalScroll} onChange={(v) => setPrefs({ naturalScroll: v })} />
        <Toggle label="Haptic feedback" value={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} />
      </Card>

      <Card title={t('settings.notifications')}>
        {(Object.keys(NOTIF_LABELS) as (keyof NotificationPrefs)[]).map((k) => (
          <Toggle key={k} label={t(NOTIF_LABELS[k] as never)} value={prefs.notifications[k]} onChange={(v) => setPrefs({ notifications: { ...prefs.notifications, [k]: v } })} />
        ))}
        <Muted>Notifications are delivered while the app is running or recently in the background (no cloud push service).</Muted>
      </Card>

      <Card title={t('settings.diagnostics')}>
        <Muted>Status: {conn.status}{conn.error ? ` (${conn.error})` : ''}</Muted>
        <Muted>Network: {conn.network ?? '—'}</Muted>
        {conn.attempts.length > 0 && <Muted>Last attempt:</Muted>}
        {conn.attempts.map((a, i) => (
          <Muted key={i}>{`${a.ok ? '✓' : '✗'} ${details ? a.address : t(`route.${addressKind(a.address)}`)} · ${a.ms} ms${a.error ? ` · ${a.error}` : ''}`}</Muted>
        ))}
        <Button style={{ marginTop: spacing.md }} variant="subtle" label="Test connection" busy={probing} onPress={async () => {
          setProbing(true);
          setProbe(await connection.probe());
          setProbing(false);
        }} />
        {probe?.map((p) => (
          <Muted key={p.address}>{`${p.ok ? '✓' : '✗'} ${t(`route.${addressKind(p.address)}`)}${details ? ` ${p.address}` : ''} · ${p.detail} · ${p.ms} ms`}</Muted>
        ))}
        {details && conn.host && <Muted>{[...new Set([conn.host.lastAddress, ...conn.host.hosts].filter(Boolean))].join(', ')}</Muted>}
        <Pressable onPress={() => setDetails((d) => !d)} style={{ paddingVertical: 6 }}>
          <Text style={{ color: c.accent, fontWeight: '700', fontSize: font.small }}>{details ? t('common.hideDetails') : t('common.showDetails')}</Text>
        </Pressable>
        <Muted>{t('dash.latency')}: {conn.latency != null ? `${conn.latency} ms` : 'N/A'}</Muted>
        <Muted>PC key: {conn.host ? fingerprint(decodeBase64(conn.host.pk)) : '—'}</Muted>
        <Muted>This phone: {myKey}</Muted>
        <Button style={{ marginTop: spacing.md }} variant="ghost" label={t('common.retry')} onPress={() => connection.reconnectNow()} />
      </Card>

      {ownerEnabled && (
        <Card>
          <Text style={{ color: c.textMuted, fontSize: font.small, marginBottom: spacing.sm }}>{t('owner.yourName')}</Text>
          <Input value={prefs.userName} onChangeText={(v) => setPrefs({ userName: v.slice(0, 40) })} maxLength={40} />
          <Muted>{t('owner.notice')}</Muted>
        </Card>
      )}
      <View style={{ alignItems: 'center', marginTop: spacing.md }}>
        <Text style={{ color: c.textFaint, fontSize: font.tiny }}>FRISTY Remote v{currentVersion()}</Text>
      </View>

      <ConfirmDialog
        visible={!!forget}
        danger
        title={t('settings.forget')}
        message={forget ? `${forget.name}: this phone will forget the computer. Also revoke it on the PC to remove its access there.` : ''}
        confirmLabel={t('settings.forget')}
        onCancel={() => setForget(null)}
        onConfirm={async () => {
          const h = forget!;
          setForget(null);
          if (conn.host?.pk === h.pk) connection.disconnect();
          setHosts(await forgetHost(h.pk));
          onHostsChanged();
        }}
      />
    </ScrollView>
  );
}
