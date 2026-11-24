import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Headphones, Mic, MicOff, Music2, Pause, SkipBack, SkipForward, Speaker, Volume2, VolumeX } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemote, useRemoteAction } from '../connection/hooks';
import { Card, ErrorText, Muted, NotAllowed, Title } from '../components/ui';

/** Horizontal slider built on PanResponder (no extra native dependency). Sends at most every 80 ms. */
function Slider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const { c, rtl } = useApp();
  const [local, setLocal] = useState(value);
  const width = useRef(1);
  const last = useRef(0);
  const dragging = useRef(false);
  // PanResponder is created once; read the latest props through refs.
  const cb = useRef(onChange);
  cb.current = onChange;
  const off = useRef(disabled);
  off.current = disabled;
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const fromX = (x: number) => {
    const pct = Math.max(0, Math.min(100, Math.round((x / width.current) * 100)));
    return rtl ? 100 - pct : pct;
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !off.current,
      onMoveShouldSetPanResponder: () => !off.current,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        const v = fromX(e.nativeEvent.locationX);
        setLocal(v);
        cb.current(v);
      },
      onPanResponderMove: (e) => {
        const v = fromX(e.nativeEvent.locationX);
        setLocal(v);
        if (Date.now() - last.current > 80) {
          last.current = Date.now();
          cb.current(v);
        }
      },
      onPanResponderRelease: (e) => {
        dragging.current = false;
        cb.current(fromX(e.nativeEvent.locationX));
      }
    })
  ).current;
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      style={{ height: 36, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: local }}
    >
      <View pointerEvents="none" style={{ height: 8, borderRadius: 4, backgroundColor: c.cardBorder, overflow: 'hidden', flexDirection: rtl ? 'row-reverse' : 'row' }}>
        <View style={{ width: `${local}%`, backgroundColor: c.accent }} />
      </View>
    </View>
  );
}

export function AudioScreen() {
  const { c, t, row } = useApp();
  const conn = useConnection();
  const can = useCan('audio');
  const audio = useRemote('audio.state', {}, can);
  const act = useRemoteAction();
  const s = audio.data;

  useEffect(() => {
    if (!can) return;
    const id = setInterval(() => void audio.reload(), 4000);
    return () => clearInterval(id);
  }, [can, audio.reload]);

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.audio')}</Title><NotAllowed permission="audio" /></View>;

  const media = (action: 'playPause' | 'next' | 'previous') => void act.run(() => connection.call('audio.media', { action }));

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={audio.loading} onRefresh={() => void audio.reload()} tintColor={c.accent} />}>
      <Title>{t('nav.audio')}</Title>
      <ErrorText>{act.error || audio.error}</ErrorText>

      <Card>
        <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
          <View style={{ backgroundColor: c.accentSoft, padding: 12, borderRadius: radius.md }}>
            <Music2 color={c.accent} size={24} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.textMuted, fontSize: font.tiny, fontWeight: '800' }}>{t('audio.nowPlaying').toUpperCase()}</Text>
            <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={2}>
              {s?.nowPlaying ? `${s.nowPlaying.title}` : 'N/A'}
            </Text>
            {s?.nowPlaying && <Muted>{s.nowPlaying.app}</Muted>}
          </View>
        </View>
        <View style={{ flexDirection: row, justifyContent: 'center', gap: spacing.xl }}>
          <Pressable onPress={() => media('previous')} hitSlop={10} accessibilityLabel="Previous track">
            <SkipBack color={c.text} size={30} />
          </Pressable>
          <Pressable onPress={() => media('playPause')} style={{ backgroundColor: c.accent, borderRadius: 99, padding: 14 }} accessibilityLabel="Play / pause">
            <Pause color="#fff" size={28} />
          </Pressable>
          <Pressable onPress={() => media('next')} hitSlop={10} accessibilityLabel="Next track">
            <SkipForward color={c.text} size={30} />
          </Pressable>
        </View>
      </Card>

      <Card title={t('audio.master')} right={<Text style={{ color: c.accent, fontWeight: '800', fontSize: font.h2 }}>{s?.volume ?? 'N/A'}{s?.volume != null ? '%' : ''}</Text>}>
        <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }}>
          <Pressable
            onPress={() => s?.muted != null && void act.run(() => connection.call('audio.setMute', { muted: !s.muted })).then(audio.reload)}
            accessibilityLabel={t('audio.mute')}
          >
            {s?.muted ? <VolumeX color={c.danger} size={26} /> : <Volume2 color={c.accent} size={26} />}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Slider value={s?.volume ?? 0} disabled={s?.volume == null} onChange={(level) => connection.notify('audio.setVolume', { level })} />
          </View>
        </View>
        <Pressable
          onPress={() => s?.micMuted != null && void act.run(() => connection.call('audio.setMicMute', { muted: !s.micMuted })).then(audio.reload)}
          style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, marginTop: spacing.md }}
        >
          {s?.micMuted ? <MicOff color={c.danger} size={22} /> : <Mic color={c.success} size={22} />}
          <Text style={{ color: c.text, fontWeight: '600' }}>
            {t('audio.mic')}: {s?.micMuted == null ? 'N/A' : s.micMuted ? t('audio.mute') : t('common.enabled')}
          </Text>
        </Pressable>
      </Card>

      <Card title={t('audio.apps')}>
        {s?.sessions.length === 0 && <Muted>{t('common.none')}</Muted>}
        {s?.sessions.map((a) => (
          <View key={a.pid} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
              <Pressable onPress={() => void act.run(() => connection.call('audio.setAppMute', { pid: a.pid, muted: !a.muted })).then(audio.reload)}>
                {a.muted ? <VolumeX color={c.danger} size={18} /> : <Volume2 color={c.textMuted} size={18} />}
              </Pressable>
              <Text style={{ color: c.text, flex: 1, fontWeight: '600' }}>{a.name}</Text>
              <Text style={{ color: c.textMuted }}>{a.volume}%</Text>
            </View>
            <Slider value={a.volume} onChange={(level) => connection.notify('audio.setAppVolume', { pid: a.pid, level })} />
          </View>
        ))}
      </Card>

      {(['output', 'input'] as const).map((kind) => (
        <Card key={kind} title={t(kind === 'output' ? 'audio.output' : 'audio.input')}>
          {(kind === 'output' ? s?.outputs : s?.inputs)?.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => !d.isDefault && void act.run(() => connection.call('audio.setDefaultDevice', { deviceId: d.id, kind })).then(audio.reload)}
              style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: d.isDefault ? c.accent : c.cardBorder, marginBottom: spacing.sm }}
            >
              {kind === 'output' ? <Speaker color={d.isDefault ? c.accent : c.textMuted} size={20} /> : <Headphones color={d.isDefault ? c.accent : c.textMuted} size={20} />}
              <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>
                {d.name}
              </Text>
            </Pressable>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}
