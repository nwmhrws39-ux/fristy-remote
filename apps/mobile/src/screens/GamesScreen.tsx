import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { Heart, Play, Search, Square } from 'lucide-react-native';
import type { GameEntry } from '@fristy/protocol';
import { formatDuration } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemote, useRemoteAction } from '../connection/hooks';
import { ConfirmDialog, ErrorText, Input, Muted, NotAllowed, Pill, Title } from '../components/ui';

type Filter = 'all' | 'favorites' | 'recent';

export function GamesScreen() {
  const { c, t, row } = useApp();
  const conn = useConnection();
  const can = useCan('games');
  const games = useRemote('games.list', {}, can);
  const act = useRemoteAction();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [closing, setClosing] = useState<GameEntry | null>(null);

  const list = useMemo(() => {
    let l = (games.data ?? []).filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (filter === 'favorites') l = l.filter((g) => g.favorite);
    if (filter === 'recent') l = l.filter((g) => g.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 12);
    else l = [...l].sort((a, b) => Number(b.running) - Number(a.running) || Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
    return l;
  }, [games.data, q, filter]);

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.games')}</Title><NotAllowed permission="games" /></View>;

  const toggleFav = async (g: GameEntry) => {
    games.setData((d) => d?.map((x) => (x.id === g.id ? { ...x, favorite: !g.favorite } : x)) ?? null);
    await act.run(() => connection.call('games.favorite', { gameId: g.id, favorite: !g.favorite }));
  };

  return (
    <FlatList
      data={list}
      keyExtractor={(g) => g.id}
      numColumns={2}
      columnWrapperStyle={{ gap: spacing.md, flexDirection: row }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md }}
      refreshControl={<RefreshControl refreshing={games.loading} onRefresh={() => void games.reload()} tintColor={c.accent} />}
      ListHeaderComponent={
        <View>
          <Title>{t('nav.games')}</Title>
          <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
            <Search color={c.textFaint} size={18} />
            <Input style={{ flex: 1 }} placeholder={t('common.search')} value={q} onChangeText={setQ} />
          </View>
          <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.md }}>
            {(['all', 'favorites', 'recent'] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: filter === f ? c.accent : c.card }}>
                <Text style={{ color: filter === f ? '#fff' : c.textMuted, fontWeight: '700', fontSize: font.small }}>{t(f === 'all' ? 'common.all' : f === 'favorites' ? 'common.favorites' : 'common.recent')}</Text>
              </Pressable>
            ))}
          </View>
          <ErrorText>{act.error || games.error}</ErrorText>
          {games.data && list.length === 0 && <Muted center>{t('games.empty')}</Muted>}
        </View>
      }
      renderItem={({ item: g }) => (
        <View style={{ flex: 1, maxWidth: '50%', backgroundColor: c.card, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: g.running ? c.success : c.cardBorder }}>
          <View style={{ aspectRatio: 460 / 215, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
            {g.artworkUrl ? (
              <Image source={{ uri: g.artworkUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <Text style={{ color: c.accent, fontWeight: '900', fontSize: 26 }}>{g.name.slice(0, 2).toUpperCase()}</Text>
            )}
            <Pressable onPress={() => void toggleFav(g)} hitSlop={10} style={{ position: 'absolute', top: 6, right: 6, backgroundColor: '#0008', borderRadius: 99, padding: 6 }}>
              <Heart size={16} color={g.favorite ? '#FF5BB8' : '#fff'} fill={g.favorite ? '#FF5BB8' : 'transparent'} />
            </Pressable>
            {g.running && (
              <View style={{ position: 'absolute', bottom: 6, left: 6 }}>
                <Pill tone="ok">{t('common.running')}</Pill>
              </View>
            )}
          </View>
          <View style={{ padding: spacing.md }}>
            <Text numberOfLines={1} style={{ color: c.text, fontWeight: '700' }}>
              {g.name}
            </Text>
            <Text style={{ color: c.textFaint, fontSize: font.tiny, marginTop: 2 }}>
              {t('games.playtime')}: {formatDuration(g.playtimeSec)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={g.running ? t('games.close') : `${t('games.play')} ${g.name}`}
              onPress={() =>
                g.running
                  ? setClosing(g)
                  : void act.run(async () => {
                      await connection.call('games.launch', { gameId: g.id });
                      setTimeout(() => void games.reload(), 6000);
                    })
              }
              style={({ pressed }) => ({
                marginTop: spacing.sm,
                height: 38,
                borderRadius: radius.md,
                backgroundColor: g.running ? c.danger + '22' : c.accent,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: pressed ? 0.8 : 1
              })}
            >
              {g.running ? <Square size={14} color={c.danger} /> : <Play size={14} color="#fff" fill="#fff" />}
              <Text style={{ color: g.running ? c.danger : '#fff', fontWeight: '900', letterSpacing: 1 }}>{g.running ? t('apps.close') : t('games.play')}</Text>
            </Pressable>
          </View>
        </View>
      )}
      ListFooterComponent={
        <ConfirmDialog
          visible={!!closing}
          danger
          title={t('games.close')}
          message={closing ? t('games.confirmClose', { name: closing.name }) : ''}
          confirmLabel={t('games.close')}
          onCancel={() => setClosing(null)}
          onConfirm={() => {
            const g = closing!;
            setClosing(null);
            void act.run(() => connection.call('games.close', { gameId: g.id, confirm: true }, 40_000)).then(() => games.reload());
          }}
        />
      }
    />
  );
}
