import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Lock, Moon, MonitorOff, Power, PowerOff, RotateCcw, Snowflake, Sunrise, Timer } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemoteAction } from '../connection/hooks';
import { sendWakeOnLan } from '../connection/udp';
import { Button, Card, ConfirmDialog, ErrorText, Muted, NotAllowed, Title, haptic } from '../components/ui';

type Action = 'shutdown' | 'restart' | 'sleep' | 'hibernate' | 'lock' | 'monitorOff';

export function PowerScreen() {
  const { c, t, row, prefs } = useApp();
  const conn = useConnection();
  const can = useCan('power');
  const act = useRemoteAction();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [now, setNow] = useState(Date.now());
  const [wolMsg, setWolMsg] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const actions: { id: Action; label: string; icon: typeof Power; danger?: boolean }[] = [
    { id: 'shutdown', label: t('power.shutdown'), icon: PowerOff, danger: true },
    { id: 'restart', label: t('power.restart'), icon: RotateCcw, danger: true },
    { id: 'sleep', label: t('power.sleep'), icon: Moon },
    { id: 'hibernate', label: t('power.hibernate'), icon: Snowflake },
    { id: 'lock', label: t('power.lock'), icon: Lock },
    { id: 'monitorOff', label: t('power.monitorOff'), icon: MonitorOff }
  ];

  const run = (a: Action) => {
    haptic(prefs.haptics, 'medium');
    void act.run(() => connection.call('power.action', { action: a, confirm: a === 'shutdown' || a === 'restart' ? true : undefined }));
  };

  const schedule = conn.powerSchedule;
  const remaining = schedule ? Math.max(0, Math.round((schedule.at - now) / 1000)) : 0;
  const host = conn.host;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Title>{t('nav.power')}</Title>
      {conn.status === 'online' && !can && <NotAllowed permission="power" />}
      {can && (
        <>
          <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.md }}>
            {actions.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                onPress={() => (a.danger ? setConfirm(a.id) : run(a.id))}
                style={({ pressed }) => ({
                  width: '47.5%',
                  aspectRatio: 1.35,
                  borderRadius: radius.lg,
                  backgroundColor: a.danger ? c.danger + '18' : c.card,
                  borderColor: a.danger ? c.danger + '55' : c.cardBorder,
                  borderWidth: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  transform: [{ scale: pressed ? 0.96 : 1 }]
                })}
              >
                <a.icon size={32} color={a.danger ? c.danger : c.accent} />
                <Text style={{ color: c.text, fontWeight: '700', fontSize: font.body }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          <ErrorText>{act.error}</ErrorText>

          <Card title={t('power.schedule')} style={{ marginTop: spacing.lg }} right={<Timer color={c.accent} size={20} />}>
            {schedule && remaining > 0 ? (
              <>
                <Text style={{ color: c.text, fontSize: 40, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] }}>
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                </Text>
                <Muted center>{t('power.scheduledAt', { action: schedule.action === 'restart' ? t('power.restart') : t('power.shutdown'), time: new Date(schedule.at).toLocaleTimeString() })}</Muted>
                <Button style={{ marginTop: spacing.lg }} variant="danger" label={t('power.cancelSchedule')} onPress={() => void act.run(() => connection.call('power.cancelSchedule', {}))} />
              </>
            ) : (
              <>
                <View style={{ flexDirection: row, gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md }}>
                  {[15, 30, 60, 120, 240].map((m) => (
                    <Pressable key={m} onPress={() => setMinutes(m)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: minutes === m ? c.accent : c.bgElevated }}>
                      <Text style={{ color: minutes === m ? '#fff' : c.text, fontWeight: '700' }}>{m >= 60 ? `${m / 60}h` : `${m}m`}</Text>
                    </Pressable>
                  ))}
                </View>
                <Button label={`${t('power.scheduleIn')} ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}`} busy={act.busy} onPress={() => void act.run(() => connection.call('power.schedule', { action: 'shutdown', delaySec: minutes * 60, confirm: true }))} />
              </>
            )}
          </Card>
        </>
      )}

      <Card title={t('power.wake')} right={<Sunrise color={c.accent} size={20} />}>
        {host?.mac ? (
          <>
            <Muted>
              MAC {host.mac}
              {host.broadcast ? ` · ${host.broadcast}` : ''}
            </Muted>
            <Button
              style={{ marginTop: spacing.md }}
              label={t('power.wake')}
              disabled={conn.status === 'online'}
              onPress={() =>
                void sendWakeOnLan(host.mac!, host.broadcast).then(
                  () => {
                    setWolMsg('Magic packet sent. The PC may take up to a minute to come online.');
                    setTimeout(() => connection.reconnectNow(), 15_000);
                  },
                  (e: Error) => setWolMsg(e.message)
                )
              }
            />
            {wolMsg && <Muted>{wolMsg}</Muted>}
          </>
        ) : (
          <Muted>Connect once with the "System monitor" permission so the phone can learn the PC's network adapter address.</Muted>
        )}
        <View style={{ marginTop: spacing.md }}>
          <Muted>{t('power.wolHelp')}</Muted>
        </View>
      </Card>

      <ConfirmDialog
        visible={confirm !== null}
        danger
        title={confirm === 'restart' ? t('power.restart') : t('power.shutdown')}
        message={confirm === 'restart' ? t('power.confirmRestart') : t('power.confirmShutdown')}
        confirmLabel={confirm === 'restart' ? t('power.restart') : t('power.shutdown')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const a = confirm!;
          setConfirm(null);
          run(a);
        }}
      />
    </ScrollView>
  );
}
