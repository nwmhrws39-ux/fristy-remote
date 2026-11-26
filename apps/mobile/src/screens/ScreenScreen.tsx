import { useCallback, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { ArrowDown, ArrowUp, Camera, Expand, Keyboard, Minimize2, Monitor } from 'lucide-react-native';
import { decodeBase64 } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection } from '../connection/hooks';
import { ErrorText, Muted, NotAllowed, Title, haptic } from '../components/ui';
import { FrameView, QUALITY, useCursor, useDisplays, useScreenStream, type Quality } from '../screen/stream';

/** Live view of the PC screen with the mouse cursor, tap-to-click and pinch zoom. */
export function ScreenScreen() {
  useKeepAwake();
  const { c, t, row, prefs } = useApp();
  const conn = useConnection();
  const win = useWindowDimensions();
  const can = useCan('screen');
  const canInput = useCan('input') && (conn.accepted?.host.inputEnabled ?? false);
  const [quality, setQuality] = useState<Quality>('auto');
  const [full, setFull] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const keyboard = useRef<ComponentRef<typeof TextInput>>(null);
  const { displays, displayId, setDisplayId, error: dispError } = useDisplays(can);
  const { frame, fps, error, level } = useScreenStream(can, displayId, quality);
  const cursor = useCursor(can, displayId);

  const click = useCallback(
    (x: number, y: number, button: 'left' | 'right') => {
      if (!canInput || !displayId) return;
      haptic(prefs.haptics, button === 'right' ? 'medium' : 'light');
      void connection
        .call('input.moveTo', { displayId, x, y })
        .then(() => connection.call('input.mouseButton', { button, action: 'click' }))
        .catch(() => undefined);
    },
    [canInput, displayId, prefs.haptics]
  );

  const saveScreenshot = useCallback(async () => {
    if (!displayId) return;
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) return setNote('Photos permission denied');
      const f = await connection.call('screen.frame', { displayId, maxWidth: 3840, quality: 95 }, 30_000);
      const file = new File(Paths.cache, `fristy-${Date.now()}.jpg`);
      file.create();
      file.write(decodeBase64(f.data));
      await MediaLibrary.saveToLibraryAsync(file.uri);
      file.delete();
      setNote(t('screen.saved'));
      haptic(prefs.haptics, 'medium');
    } catch (e) {
      setNote((e as Error).message);
    }
  }, [displayId, prefs.haptics, t]);

  if (conn.status === 'online' && !can) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Title>{t('screen.title')}</Title>
        <NotAllowed permission="screen" />
      </View>
    );
  }

  const aspect = frame ? frame.w / frame.h : 16 / 9;
  const viewer = (fullscreen: boolean) => (
    <ScrollView
      maximumZoomScale={4}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={{ borderRadius: fullscreen ? 0 : radius.lg, backgroundColor: '#000', marginVertical: fullscreen ? 0 : spacing.md, flexGrow: 0 }}
      contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <FrameView
        frame={frame}
        cursor={cursor}
        width={fullscreen ? Math.min(win.width, win.height * aspect) : '100%'}
        onTap={canInput ? (x, y) => click(x, y, 'left') : undefined}
        onLongTap={canInput ? (x, y) => click(x, y, 'right') : undefined}
      />
    </ScrollView>
  );
  const err = dispError ?? error;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="always">
      <View style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('screen.title')}</Title>
        <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{frame ? `${fps.toFixed(1)} fps · ${frame.w}×${frame.h}${quality === 'auto' ? ` · ${t(`screen.${level}`)}` : ''}` : ''}</Text>
      </View>
      {err && /disabled/i.test(err) ? <ErrorText>{t('screen.disabled')}</ErrorText> : <ErrorText>{err}</ErrorText>}

      {viewer(false)}
      <Muted center>{canInput ? t('screen.tapHint') : t('screen.viewOnly')}</Muted>

      <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
        <ToolButton icon={<Expand color={c.accent} size={18} />} label={t('input.fullscreen')} onPress={() => setFull(true)} />
        <ToolButton icon={<Camera color={c.accent} size={18} />} label={t('screen.save')} onPress={() => void saveScreenshot()} />
        {canInput && (
          <>
            <ToolButton icon={<Keyboard color={c.accent} size={18} />} label={t('input.keyboard')} onPress={() => keyboard.current?.focus()} />
            <ToolButton icon={<ArrowUp color={c.accent} size={18} />} onPress={() => connection.notify('input.scroll', { dx: 0, dy: 3 })} />
            <ToolButton icon={<ArrowDown color={c.accent} size={18} />} onPress={() => connection.notify('input.scroll', { dx: 0, dy: -3 })} />
          </>
        )}
      </View>
      {note && <Muted>{note}</Muted>}

      <Text style={{ color: c.textMuted, fontWeight: '800', fontSize: font.tiny, letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm }}>{t('screen.quality').toUpperCase()}</Text>
      <View style={{ flexDirection: row, gap: spacing.sm }}>
        {(Object.keys(QUALITY) as Quality[]).map((q) => (
          <Pressable key={q} onPress={() => setQuality(q)} style={{ flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: quality === q ? c.accent : c.card }}>
            <Text style={{ color: quality === q ? '#fff' : c.text, fontWeight: '700', fontSize: font.small }}>{t(`screen.${q}`)}</Text>
          </Pressable>
        ))}
      </View>

      {displays && displays.length > 1 && (
        <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
          {displays.map((d, i) => (
            <Pressable
              key={d.id}
              onPress={() => setDisplayId(d.id)}
              style={{ flexDirection: row, alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 38, borderRadius: radius.md, borderWidth: 1, borderColor: displayId === d.id ? c.accent : c.cardBorder }}
            >
              <Monitor size={16} color={displayId === d.id ? c.accent : c.textMuted} />
              <Text style={{ color: c.text }}>{d.name || `${i + 1}`}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        ref={keyboard}
        value=""
        autoCorrect={false}
        autoCapitalize="none"
        blurOnSubmit={false}
        onChangeText={(text) => text && connection.notify('input.text', { text: text.slice(0, 256) })}
        onKeyPress={({ nativeEvent }) => nativeEvent.key === 'Backspace' && connection.notify('input.key', { key: 'backspace', modifiers: [] })}
        onSubmitEditing={() => connection.notify('input.key', { key: 'enter', modifiers: [] })}
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
        <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
          {viewer(true)}
          <Pressable onPress={() => setFull(false)} style={{ position: 'absolute', top: 40, right: 20, padding: 10, backgroundColor: '#0008', borderRadius: 99 }} accessibilityLabel={t('common.close')}>
            <Minimize2 color="#fff" size={20} />
          </Pressable>
          {canInput && (
            <Pressable onPress={() => keyboard.current?.focus()} style={{ position: 'absolute', top: 40, left: 20, padding: 10, backgroundColor: '#0008', borderRadius: 99 }} accessibilityLabel={t('input.keyboard')}>
              <Keyboard color="#fff" size={20} />
            </Pressable>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

function ToolButton({ icon, label, onPress }: { icon: ReactNode; label?: string; onPress: () => void }) {
  const { c } = useApp();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 40, borderRadius: radius.md, backgroundColor: pressed ? c.accentSoft : c.card, borderWidth: 1, borderColor: c.cardBorder })}>
      {icon}
      {label ? <Text style={{ color: c.text, fontWeight: '600', fontSize: font.small }}>{label}</Text> : null}
    </Pressable>
  );
}
