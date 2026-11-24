import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Circle } from 'react-native-svg';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';

export function haptic(enabled: boolean, kind: 'light' | 'medium' | 'heavy' = 'light') {
  if (!enabled) return;
  const map = { light: Haptics.ImpactFeedbackStyle.Light, medium: Haptics.ImpactFeedbackStyle.Medium, heavy: Haptics.ImpactFeedbackStyle.Heavy };
  void Haptics.impactAsync(map[kind]).catch(() => undefined);
}

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useApp();
  return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const { c, align } = useApp();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '800', textAlign: align, letterSpacing: -0.5 }}>{children}</Text>
      {sub ? <Text style={{ color: c.textMuted, fontSize: font.small, marginTop: 4, textAlign: align }}>{sub}</Text> : null}
    </View>
  );
}

export function Card({ children, style, title, right }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: ReactNode; right?: ReactNode }) {
  const { c, row, align } = useApp();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View
      style={[
        { backgroundColor: c.card, borderColor: c.cardBorder, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
        { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
        style
      ]}
    >
      {title || right ? (
        <View style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '700', textAlign: align }}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </Animated.View>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  icon,
  style,
  big
}: {
  label: string;
  onPress: () => void;
  variant?: BtnVariant;
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const { c, prefs, row } = useApp();
  const bg = { primary: c.accent, ghost: 'transparent', danger: c.danger + '22', subtle: c.bgElevated }[variant];
  const fg = { primary: '#fff', ghost: c.text, danger: c.danger, subtle: c.text }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={() => {
        haptic(prefs.haptics);
        onPress();
      }}
      style={({ pressed }) => [
        {
          flexDirection: row,
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          height: big ? 56 : 46,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: variant === 'ghost' || variant === 'danger' ? 1 : 0,
          borderColor: variant === 'danger' ? c.danger + '66' : c.cardBorder,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }]
        },
        variant === 'primary' && { shadowColor: c.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
        style
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontWeight: '700', fontSize: big ? font.h2 : font.body }}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const { c, align } = useApp();
  return (
    <TextInput
      placeholderTextColor={c.textFaint}
      {...props}
      style={[
        { height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bgElevated, color: c.text, paddingHorizontal: spacing.md, fontSize: font.body, textAlign: align },
        props.style
      ]}
    />
  );
}

export function Muted({ children, center }: { children: ReactNode; center?: boolean }) {
  const { c, align } = useApp();
  return <Text style={{ color: c.textMuted, fontSize: font.small, textAlign: center ? 'center' : align, lineHeight: 19 }}>{children}</Text>;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  const { c } = useApp();
  if (!children) return null;
  return (
    <View style={{ backgroundColor: c.danger + '1A', borderColor: c.danger + '55', borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginVertical: spacing.sm }}>
      <Text style={{ color: c.danger, fontSize: font.small }}>{children}</Text>
    </View>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent' | 'neutral' }) {
  const { c } = useApp();
  const color = { ok: c.success, warn: c.warning, bad: c.danger, accent: c.accent, neutral: c.textMuted }[tone];
  return (
    <View style={{ backgroundColor: color + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.4 }}>{children}</Text>
    </View>
  );
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { c, t, row } = useApp();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: spacing.xl }}>
        <View style={{ backgroundColor: c.bgElevated, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: c.cardBorder }}>
          <Text style={{ color: c.text, fontSize: font.h1, fontWeight: '800', marginBottom: spacing.sm }}>{title}</Text>
          <Text style={{ color: c.textMuted, fontSize: font.body, lineHeight: 22 }}>{message}</Text>
          <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.xl }}>
            <Button style={{ flex: 1 }} variant="ghost" label={t('common.cancel')} onPress={onCancel} />
            <Button style={{ flex: 1 }} variant={danger ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Live area chart (values 0..max, null = gap). */
export function Sparkline({ values, max = 100, height = 46, color }: { values: (number | null)[]; max?: number; height?: number; color?: string }) {
  const { c, rtl } = useApp();
  const stroke = color ?? c.accent;
  const w = 200;
  const pts = values
    .map((v, i) => (v === null ? null : ([(i / Math.max(1, values.length - 1)) * w, height - (Math.min(v, max) / max) * (height - 4) - 2] as const)))
    .filter((p): p is readonly [number, number] => p !== null);
  if (pts.length < 2) return <View style={{ height }} />;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]![0]},${height} L${pts[0]![0]},${height} Z`;
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={rtl ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Defs>
        <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.45} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#spark)" />
      <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#B794FF" />
          <Stop offset="1" stopColor="#6236E0" />
        </LinearGradient>
      </Defs>
      <Rect x={2} y={2} width={60} height={60} rx={18} fill="url(#logo)" />
      <Path d="M22 16h24v8H31v6h12v8H31v10h-9z" fill="#fff" />
      <Circle cx={46} cy={44} r={4} fill="#fff" opacity={0.85} />
    </Svg>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  const { c } = useApp();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!online) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    );
    a.start();
    return () => a.stop();
  }, [online, pulse]);
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: online ? c.success : c.textFaint, opacity: online ? pulse : 1 }} />;
}

export function NotAllowed({ permission }: { permission: string }) {
  const { t } = useApp();
  return (
    <Card>
      <Muted center>
        {`${t('devices.permissions')}: "${permission}" – ${t('common.disabled')}. `}
        The PC owner can grant it in FRISTY Remote → Devices.
      </Muted>
    </Card>
  );
}
