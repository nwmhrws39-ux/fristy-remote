import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Expand, Keyboard, Minimize2, Monitor, MousePointerClick, Pause, Play, SkipBack, SkipForward, VolumeX } from 'lucide-react-native';
import { FrameView, useCursor, useDisplays, useScreenStream } from '../screen/stream';
import type { KeyName } from '@fristy/protocol';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection } from '../connection/hooks';
import { ConfirmDialog, Muted, NotAllowed, Title, haptic } from '../components/ui';

type Mod = 'ctrl' | 'alt' | 'shift' | 'win';
const SHORTCUTS: { label: string; key: KeyName; mods?: Mod[]; confirm?: boolean }[] = [
  { label: 'Esc', key: 'escape' },
  { label: 'Tab', key: 'tab' },
  { label: 'Win', key: 'win' },
  { label: 'Alt+Tab', key: 'tab', mods: ['alt'] },
  { label: 'Win+D', key: 'd', mods: ['win'] },
  { label: 'Ctrl+C', key: 'c', mods: ['ctrl'] },
  { label: 'Ctrl+V', key: 'v', mods: ['ctrl'] },
  { label: 'Ctrl+X', key: 'x', mods: ['ctrl'] },
  { label: 'Ctrl+Z', key: 'z', mods: ['ctrl'] },
  { label: 'Ctrl+A', key: 'a', mods: ['ctrl'] },
  { label: 'Ctrl+S', key: 's', mods: ['ctrl'] },
  { label: 'Win+Shift+S', key: 's', mods: ['win', 'shift'] },
  { label: 'Ctrl+Shift+Esc', key: 'escape', mods: ['ctrl', 'shift'] },
  { label: 'F5', key: 'f5' },
  { label: 'F11', key: 'f11' },
  { label: 'Alt+F4', key: 'f4', mods: ['alt'], confirm: true },
  { label: '←', key: 'left' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: '→', key: 'right' },
  { label: 'Home', key: 'home' },
  { label: 'End', key: 'end' },
  { label: 'PgUp', key: 'pageUp' },
  { label: 'PgDn', key: 'pageDown' },
  { label: 'PrtSc', key: 'printScreen' },
  { label: 'Del', key: 'delete' }
];

/** Touchpad surface: tap = click, 2-finger tap = right click, 2-finger drag = scroll, long-press then drag = drag & drop. */
function Touchpad({ height }: { height: number | '100%' }) {
  const { c, prefs, t } = useApp();
  const acc = useRef({ dx: 0, dy: 0, sx: 0, sy: 0 });
  const g = useRef({ lastX: 0, lastY: 0, start: 0, moved: 0, maxTouches: 0, dragging: false, longTimer: null as ReturnType<typeof setTimeout> | null });
  const [dragging, setDragging] = useState(false);
  const sens = prefs.sensitivity;
  const natural = prefs.naturalScroll;

  // Flush accumulated deltas ~60 times per second.
  useEffect(() => {
    const id = setInterval(() => {
      const a = acc.current;
      const mx = Math.trunc(a.dx);
      const my = Math.trunc(a.dy);
      if (mx || my) {
        a.dx -= mx;
        a.dy -= my;
        connection.notify('input.mouseMove', { dx: Math.max(-2000, Math.min(2000, mx)), dy: Math.max(-2000, Math.min(2000, my)) });
      }
      const sy = Math.trunc(a.sy);
      const sx = Math.trunc(a.sx);
      if (sy || sx) {
        a.sy -= sy;
        a.sx -= sx;
        connection.notify('input.scroll', { dx: Math.max(-50, Math.min(50, sx)), dy: Math.max(-50, Math.min(50, sy)) });
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_e, s) => {
          const st = g.current;
          st.lastX = s.dx;
          st.lastY = s.dy;
          st.start = Date.now();
          st.moved = 0;
          st.maxTouches = s.numberActiveTouches;
          st.longTimer = setTimeout(() => {
            if (st.moved < 8 && st.maxTouches === 1) {
              st.dragging = true;
              setDragging(true);
              haptic(prefs.haptics, 'medium');
              connection.notify('input.mouseButton', { button: 'left', action: 'down' });
            }
          }, 450);
        },
        onPanResponderMove: (_e, s) => {
          const st = g.current;
          st.maxTouches = Math.max(st.maxTouches, s.numberActiveTouches);
          const ddx = s.dx - st.lastX;
          const ddy = s.dy - st.lastY;
          st.lastX = s.dx;
          st.lastY = s.dy;
          st.moved += Math.abs(ddx) + Math.abs(ddy);
          if (s.numberActiveTouches >= 2) {
            // Wheel +dy scrolls up. "Natural" scrolling moves content with the fingers.
            const dir = natural ? 1 : -1;
            acc.current.sy += (ddy / 18) * dir;
            acc.current.sx += (ddx / 18) * -dir;
            return;
          }
          const speed = Math.hypot(ddx, ddy);
          const factor = sens * (1 + Math.min(speed, 40) / 22);
          acc.current.dx += ddx * factor;
          acc.current.dy += ddy * factor;
        },
        onPanResponderRelease: () => {
          const st = g.current;
          if (st.longTimer) clearTimeout(st.longTimer);
          if (st.dragging) {
            st.dragging = false;
            setDragging(false);
            connection.notify('input.mouseButton', { button: 'left', action: 'up' });
            return;
          }
          const quick = Date.now() - st.start < 260 && st.moved < 10;
          if (quick) {
            haptic(prefs.haptics);
            connection.notify('input.mouseButton', { button: st.maxTouches >= 2 ? 'right' : 'left', action: 'click' });
          }
        },
        onPanResponderTerminate: () => {
          const st = g.current;
          if (st.longTimer) clearTimeout(st.longTimer);
          if (st.dragging) connection.notify('input.mouseButton', { button: 'left', action: 'up' });
          st.dragging = false;
          setDragging(false);
        }
      }),
    [sens, natural, prefs.haptics]
  );

  return (
    <View
      {...responder.panHandlers}
      accessibilityLabel="Touchpad"
      style={{
        height,
        flex: height === '100%' ? 1 : undefined,
        borderRadius: radius.xl,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: dragging ? c.accent : c.cardBorder,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <MousePointerClick color={c.textFaint} size={28} />
      <Text style={{ color: c.textFaint, fontSize: font.small, marginTop: 8 }}>{dragging ? t('input.drag') : 'Tap · 2-finger tap · 2-finger scroll · hold to drag'}</Text>
    </View>
  );
}

function MouseButtons() {
  const { c, row, prefs } = useApp();
  const btn = (label: string, button: 'left' | 'middle' | 'right', flex: number) => (
    <Pressable
      key={button}
      onPress={() => {
        haptic(prefs.haptics);
        connection.notify('input.mouseButton', { button, action: 'click' });
      }}
      onLongPress={() => connection.notify('input.mouseButton', { button, action: 'double' })}
      style={({ pressed }) => ({ flex, height: 54, borderRadius: radius.md, backgroundColor: pressed ? c.accentSoft : c.card, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' })}
    >
      <Text style={{ color: c.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  return <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.sm }}>{[btn('L', 'left', 3), btn('M', 'middle', 1), btn('R', 'right', 3)]}</View>;
}

export function TouchpadScreen() {
  useKeepAwake();
  const { c, t, row, prefs, setPrefs } = useApp();
  const conn = useConnection();
  const can = useCan('input');
  const [full, setFull] = useState(false);
  const [confirm, setConfirm] = useState<(typeof SHORTCUTS)[number] | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const enabled = conn.accepted?.host.inputEnabled ?? false;
  // Optional live preview of the PC screen (with the mouse cursor) above the touchpad.
  const canScreen = !!conn.accepted?.permissions.includes('screen') && conn.status === 'online';
  const [showScreen, setShowScreen] = useState(false);
  const preview = showScreen && canScreen;
  const { displayId } = useDisplays(preview);
  const { frame, error: screenError } = useScreenStream(preview, displayId, 'auto');
  const cursor = useCursor(preview, displayId);

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.input')}</Title><NotAllowed permission="input" /></View>;

  const key = (k: KeyName, mods: Mod[] = []) => {
    haptic(prefs.haptics);
    connection.notify('input.key', { key: k, modifiers: mods });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="always">
      <View style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('nav.input')}</Title>
        <View style={{ flexDirection: row, gap: spacing.sm }}>
          <Pressable onPress={() => inputRef.current?.focus()} style={{ padding: 10, backgroundColor: c.card, borderRadius: radius.md }} accessibilityLabel={t('input.keyboard')}>
            <Keyboard color={c.accent} size={22} />
          </Pressable>
          {canScreen && (
            <Pressable onPress={() => setShowScreen((v) => !v)} style={{ padding: 10, backgroundColor: showScreen ? c.accent : c.card, borderRadius: radius.md }} accessibilityLabel={t('input.showScreen')}>
              <Monitor color={showScreen ? '#fff' : c.accent} size={22} />
            </Pressable>
          )}
          <Pressable onPress={() => setFull(true)} style={{ padding: 10, backgroundColor: c.card, borderRadius: radius.md }} accessibilityLabel={t('input.fullscreen')}>
            <Expand color={c.accent} size={22} />
          </Pressable>
        </View>
      </View>
      {!enabled && (
        <View style={{ marginBottom: spacing.md }}>
          <Muted>{t('input.disabled')}</Muted>
        </View>
      )}
      <View pointerEvents={enabled ? 'auto' : 'none'} style={{ opacity: enabled ? 1 : 0.4 }}>
        {preview && (
          <View style={{ borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm }}>
            <FrameView frame={frame} cursor={cursor} />
          </View>
        )}
        {preview && screenError && <Muted>{/disabled/i.test(screenError) ? t('screen.disabled') : screenError}</Muted>}
        <Touchpad height={preview ? 220 : 300} />
        <MouseButtons />

        {/* Hidden input that forwards typed characters. Text is sent, never stored or logged. */}
        <TextInput
          ref={inputRef}
          value=""
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          blurOnSubmit={false}
          placeholder={t('input.typeHere')}
          placeholderTextColor={c.textFaint}
          onChangeText={(text) => text && connection.notify('input.text', { text: text.slice(0, 256) })}
          onKeyPress={({ nativeEvent }) => nativeEvent.key === 'Backspace' && key('backspace')}
          onSubmitEditing={() => key('enter')}
          style={{ marginTop: spacing.md, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bgElevated, color: c.text, paddingHorizontal: spacing.md }}
        />

        <Text style={{ color: c.textMuted, fontWeight: '800', fontSize: font.tiny, letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm }}>{t('input.shortcuts').toUpperCase()}</Text>
        <View style={{ flexDirection: row, flexWrap: 'wrap', gap: 8 }}>
          {SHORTCUTS.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => (s.confirm ? setConfirm(s) : key(s.key, s.mods))}
              style={({ pressed }) => ({ paddingHorizontal: 14, height: 40, justifyContent: 'center', borderRadius: radius.md, backgroundColor: pressed ? c.accentSoft : c.card, borderWidth: 1, borderColor: c.cardBorder })}
            >
              <Text style={{ color: c.text, fontWeight: '700', fontSize: font.small }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.lg }}>
          {(
            [
              [SkipBack, 'mediaPrevious'],
              [Pause, 'mediaPlayPause'],
              [Play, 'mediaPlayPause'],
              [SkipForward, 'mediaNext'],
              [VolumeX, 'volumeMute']
            ] as const
          ).map(([Icon, k], i) => (
            <Pressable key={i} onPress={() => key(k)} style={({ pressed }) => ({ flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: pressed ? c.accentSoft : c.card })}>
              <Icon color={c.accent} size={20} />
            </Pressable>
          ))}
        </View>

        <Text style={{ color: c.textMuted, fontWeight: '800', fontSize: font.tiny, letterSpacing: 1, marginTop: spacing.lg }}>
          {t('input.sensitivity').toUpperCase()} · {prefs.sensitivity.toFixed(1)}×
        </Text>
        <View style={{ flexDirection: row, gap: 8, marginTop: spacing.sm }}>
          {[0.6, 1, 1.4, 2, 2.8].map((v) => (
            <Pressable key={v} onPress={() => setPrefs({ sensitivity: v })} style={{ flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: prefs.sensitivity === v ? c.accent : c.card }}>
              <Text style={{ color: prefs.sensitivity === v ? '#fff' : c.text, fontWeight: '700' }}>{v}×</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ marginTop: spacing.lg }}>
        <Muted center>{t('input.emergency')}</Muted>
      </View>

      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)} supportedOrientations={['portrait', 'landscape']}>
        <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.md, paddingTop: 48 }}>
          <Touchpad height="100%" />
          <MouseButtons />
          <Pressable onPress={() => setFull(false)} style={{ position: 'absolute', top: 52, right: 24, padding: 10 }} accessibilityLabel={t('common.close')}>
            <Minimize2 color={c.textMuted} size={22} />
          </Pressable>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.label ?? ''}
        message="Close the active window on the PC?"
        confirmLabel={t('common.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const s = confirm!;
          setConfirm(null);
          key(s.key, s.mods);
        }}
      />
    </ScrollView>
  );
}
