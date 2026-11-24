import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { AppWindow, Globe, Heart, X } from 'lucide-react-native';
import type { AppEntry } from '@fristy/protocol';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemote, useRemoteAction } from '../connection/hooks';
import { Card, ConfirmDialog, ErrorText, Muted, NotAllowed, Pill, Title } from '../components/ui';

export function AppsScreen() {
  const { c, t, row } = useApp();
  const conn = useConnection();
  const can = useCan('apps');
  const apps = useRemote('apps.list', {}, can);
  const urls = useRemote('apps.urls', {}, can);
  const act = useRemoteAction();
  const [closing, setClosing] = useState<AppEntry | null>(null);

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.apps')}</Title><NotAllowed permission="apps" /></View>;

  const sorted = [...(apps.data ?? [])].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={apps.loading} onRefresh={() => void (apps.reload(), urls.reload())} tintColor={c.accent} />}
    >
      <Title sub="Only applications approved on the PC are listed.">{t('nav.apps')}</Title>
      <ErrorText>{act.error || apps.error}</ErrorText>
      <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.md }}>
        {sorted.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={`${t('apps.launch')} ${a.name}`}
            onPress={() => void act.run(() => connection.call('apps.launch', { appId: a.id })).then(() => setTimeout(() => void apps.reload(), 3000))}
            onLongPress={() => a.running && setClosing(a)}
            style={({ pressed }) => ({
              width: '30.5%',
              aspectRatio: 0.9,
              backgroundColor: c.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: a.running ? c.success + '88' : c.cardBorder,
              alignItems: 'center',
              justifyContent: 'center',
              padding: spacing.sm,
              transform: [{ scale: pressed ? 0.95 : 1 }]
            })}
          >
            {a.icon ? <Image source={{ uri: a.icon }} style={{ width: 40, height: 40 }} /> : <AppWindow color={c.accent} size={36} />}
            <Text numberOfLines={1} style={{ color: c.text, fontWeight: '700', fontSize: font.small, marginTop: 8 }}>
              {a.name}
            </Text>
            <View style={{ position: 'absolute', top: 6, right: 6 }}>
              <Pressable hitSlop={8} onPress={() => void act.run(() => connection.call('apps.favorite', { appId: a.id, favorite: !a.favorite })).then(apps.reload)}>
                <Heart size={14} color={a.favorite ? '#FF5BB8' : c.textFaint} fill={a.favorite ? '#FF5BB8' : 'transparent'} />
              </Pressable>
            </View>
            {a.running && (
              <Pressable onPress={() => setClosing(a)} style={{ position: 'absolute', top: 6, left: 6 }} hitSlop={8} accessibilityLabel={t('apps.close')}>
                <X size={14} color={c.danger} />
              </Pressable>
            )}
            {a.running && (
              <View style={{ marginTop: 4 }}>
                <Pill tone="ok">{t('common.running')}</Pill>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      {apps.data?.length === 0 && <Muted center>{t('common.none')}</Muted>}

      <Card title={t('apps.urls')} style={{ marginTop: spacing.lg }}>
        {urls.data?.length === 0 && <Muted>{t('common.none')}</Muted>}
        {urls.data?.map((u) => (
          <Pressable key={u.id} onPress={() => void act.run(() => connection.call('apps.openUrl', { url: u.url }))} style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 10 }}>
            <Globe color={c.accent} size={20} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{u.label}</Text>
              <Text style={{ color: c.textFaint, fontSize: font.tiny }} numberOfLines={1}>
                {u.url}
              </Text>
            </View>
          </Pressable>
        ))}
      </Card>

      <ConfirmDialog
        visible={!!closing}
        title={t('apps.close')}
        message={closing ? t('apps.confirmClose', { name: closing.name }) : ''}
        confirmLabel={t('apps.close')}
        danger
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          const a = closing!;
          setClosing(null);
          void act.run(() => connection.call('apps.close', { appId: a.id, confirm: true }, 20_000)).then(() => apps.reload());
        }}
      />
    </ScrollView>
  );
}
