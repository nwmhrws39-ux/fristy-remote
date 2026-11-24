import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Briefcase, Code, Coffee, Film, Gamepad2, Monitor, Moon, Music, Radio, Zap } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemote, useRemoteAction } from '../connection/hooks';
import { ErrorText, Muted, NotAllowed, Title, haptic } from '../components/ui';

const ICONS: Record<string, typeof Zap> = { 'gamepad-2': Gamepad2, briefcase: Briefcase, music: Music, radio: Radio, moon: Moon, zap: Zap, monitor: Monitor, coffee: Coffee, film: Film, code: Code };

export function MacrosScreen() {
  const { c, t, row, prefs } = useApp();
  const conn = useConnection();
  const can = useCan('macros');
  const macros = useRemote('macros.list', {}, can);
  const act = useRemoteAction();

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.macros')}</Title><NotAllowed permission="macros" /></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={macros.loading} onRefresh={() => void macros.reload()} tintColor={c.accent} />}>
      <Title sub="Edit macros in FRISTY Remote on your PC.">{t('nav.macros')}</Title>
      <ErrorText>{act.error || macros.error}</ErrorText>
      {macros.data?.length === 0 && <Muted center>{t('macros.empty')}</Muted>}
      <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.md }}>
        {macros.data?.map((m) => {
          const Icon = ICONS[m.icon] ?? Zap;
          return (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              accessibilityLabel={`${t('macros.run')} ${m.name}`}
              disabled={act.busy}
              onPress={() => {
                haptic(prefs.haptics, 'medium');
                void act.run(() => connection.call('macros.run', { macroId: m.id }, 60_000));
              }}
              style={({ pressed }) => ({
                width: '47.5%',
                aspectRatio: 1.1,
                borderRadius: radius.lg,
                padding: spacing.lg,
                backgroundColor: m.color + (pressed ? '44' : '22'),
                borderColor: m.color + '88',
                borderWidth: 1,
                justifyContent: 'space-between',
                transform: [{ scale: pressed ? 0.96 : 1 }]
              })}
            >
              <View style={{ backgroundColor: m.color, alignSelf: 'flex-start', padding: 10, borderRadius: radius.md }}>
                <Icon color="#fff" size={22} />
              </View>
              <View>
                <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '800' }}>{m.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: font.tiny }}>{m.steps.length} steps</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
