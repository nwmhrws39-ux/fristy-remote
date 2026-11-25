import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { ArrowDown, ArrowUp, Camera, Expand, Keyboard, Minimize2, Monitor } from 'lucide-react-native';
import type { DisplayInfo, ScreenFrame } from '@fristy/protocol';
import { decodeBase64 } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection } from '../connection/hooks';
import { ErrorText, Muted, NotAllowed, Title, haptic } from '../components/ui';

const QUALITY = {
  low: { maxWidth: 800, quality: 40 },
  medium: { maxWidth: 1280, quality: 55 },
  high: { maxWidth: 1920, quality: 70 }
} as const;
type Quality = keyof typeof QUALITY;

/**
 * Live view of the PC screen. Frames are pulled one at a time, so the frame
 * rate adapts automatically to the connection (fast on Wi-Fi, slower via Tailscale).
 */
export function ScreenScreen() {
  useKeepAwake();
  const { c, t, row, prefs } = useApp();
  const conn = useConnection();
  const can = useCan('screen');
  const canInput = useCan('input') && (conn.accepted?.host.inputEnabled ?? false);
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>('medium');
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const keyboard = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (!can) return;
    connection
      .call('screen.displays', {})
      .then((d) => {
        setDisplays(d);
        setDisplayId((cur) => cur ?? (d.find((x) => x.primary) ?? d[0])?.id ?? null);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [can, conn.status]);

  // Pull loop: request the next frame as soon as the previous one arrived.
  useEffect(() => {
    if (!can || !displayId) return;
    let alive = true;
    const times: number[] = [];
    void (async () => {
      while (alive) {
        try {
          const f = await connection.call('screen.frame', { displayId, ...QUALITY[quality] }, 20_000);
          if (!alive) break;
          setFrame(f);
          setError(null);
          const now = Date.now();
          times.push(now);
          while (times.length && now - times[0]! > 3000) times.shift();
          setFps(times.length / 3);
        } catch (e) {
          if (!alive) break;
          setError((e as Error).message);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [can, displayId, quality, conn.status]);

  const saveScreenshot = useCallback(async () => {
    if (!displayId) return;
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) return setNote('Photos permission denied');
      const f = await connection.call('screen.frame', { displayId, maxWidth: 2560, quality: 90 }, 30_000);
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

  const viewer = (fullscreen: boolean) => (
    <ScreenView frame={frame} displayId={displayId} canInput={canInput} fullscreen={fullscreen} />
  );

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="always">
      <View style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('screen.title')}</Title>
        <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{frame ? `${fps.toFixed(1)} fps · ${frame.w}×${frame.h}` : ''}</Text>
      </View>
      {error && /disabled/i.test(error) ? <ErrorText>{t('screen.disabled')}</ErrorText> : <ErrorText>{error}</ErrorText>}

      {viewer(false)}
      <Muted center>{canInput ? t('screen.tapHint') : t('screen.viewOnly')}</Muted>

      {/* toolbar */}
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
            <Text style={{ color: quality === q ? '#fff' : c.text, fontWeight: '700' }}>{t(`screen.${q}`)}</Text>
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

      {/* hidden keyboard input (text is sent, never stored) */}
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

/** Zoomable frame (pinch on iOS). Taps map to normalized PC coordinates. */
function ScreenView({ frame, displayId, canInput, fullscreen }: { frame: ScreenFrame | null; displayId: string | null; canInput: boolean; fullscreen: boolean }) {
  const { c, prefs } = useApp();
  const win = useWindowDimensions();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const aspect = frame ? frame.w / frame.h : 16 / 9;
  // Full screen: fit the whole PC screen inside the phone screen (works in landscape too).
  const fitWidth = fullscreen ? Math.min(win.width, win.height * aspect) : undefined;

  const click = (e: GestureResponderEvent, button: 'left' | 'right') => {
    if (!canInput || !displayId || !box.w) return;
    const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / box.w));
    const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / box.h));
    haptic(prefs.haptics, button === 'right' ? 'medium' : 'light');
    void connection
      .call('input.moveTo', { displayId, x, y })
      .then(() => connection.call('input.mouseButton', { button, action: 'click' }))
      .catch(() => undefined);
  };

  return (
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
      <Pressable
        onPress={(e) => click(e, 'left')}
        onLongPress={(e) => click(e, 'right')}
        onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{ width: fitWidth ?? '100%', aspectRatio: aspect }}
      >
        {frame ? (
          <Image source={{ uri: `data:image/jpeg;base64,${frame.data}` }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" fadeDuration={0} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.accent} />
          </View>
        )}
      </Pressable>
    </ScrollView>
  );
}
