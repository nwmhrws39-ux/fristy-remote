import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { DisplayInfo, ScreenFrame } from '@fristy/protocol';
import { connection } from '../connection/manager';
import { useConnection } from '../connection/hooks';
import { useApp } from '../theme';

export const QUALITY = {
  low: { maxWidth: 960, quality: 50 },
  medium: { maxWidth: 1440, quality: 65 },
  high: { maxWidth: 1920, quality: 78 },
  max: { maxWidth: 2560, quality: 88 }
} as const;
export type Quality = keyof typeof QUALITY;

export function useDisplays(enabled: boolean) {
  const { status } = useConnection();
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || status !== 'online') return;
    connection
      .call('screen.displays', {})
      .then((d) => {
        setDisplays(d);
        setDisplayId((cur) => (cur && d.some((x) => x.id === cur) ? cur : ((d.find((x) => x.primary) ?? d[0])?.id ?? null)));
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [enabled, status]);
  return { displays, displayId, setDisplayId, error };
}

/**
 * Pulls frames one at a time: the next request starts as soon as the previous
 * frame arrived, so the frame rate adapts to the connection automatically.
 */
export function useScreenStream(enabled: boolean, displayId: string | null, quality: Quality) {
  const { status } = useConnection();
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !displayId || status !== 'online') return;
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
  }, [enabled, displayId, quality, status]);
  return { frame, fps, error };
}

/** Fast cursor-only updates (no image), so the pointer moves smoothly between frames. */
export function useCursor(enabled: boolean, displayId: string | null) {
  const { status } = useConnection();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!enabled || !displayId || status !== 'online') return;
    let alive = true;
    void (async () => {
      while (alive) {
        const t = Date.now();
        try {
          const c = await connection.call('screen.cursor', { displayId }, 5000);
          if (alive) setCursor(c);
        } catch {
          /* keep last */
        }
        await new Promise((r) => setTimeout(r, Math.max(0, 60 - (Date.now() - t))));
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, displayId, status]);
  return cursor;
}

function CursorArrow({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 2 L4 19 L8.5 14.8 L11.6 21.5 L14.4 20.2 L11.3 13.6 L17.5 13.6 Z" fill="#fff" stroke="#000" strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Shows a frame with the PC's mouse cursor drawn on top. Optional taps report
 * normalized coordinates (0..1) for click-at-position.
 */
export function FrameView({
  frame,
  cursor,
  width,
  onTap,
  onLongTap
}: {
  frame: ScreenFrame | null;
  cursor: { x: number; y: number } | null | undefined;
  width?: number | `${number}%`;
  onTap?: (x: number, y: number) => void;
  onLongTap?: (x: number, y: number) => void;
}) {
  const { c } = useApp();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const aspect = frame ? frame.w / frame.h : 16 / 9;
  const pos = cursor ?? frame?.cursor ?? null;
  const norm = (e: GestureResponderEvent) => ({
    x: Math.min(1, Math.max(0, e.nativeEvent.locationX / Math.max(1, box.w))),
    y: Math.min(1, Math.max(0, e.nativeEvent.locationY / Math.max(1, box.h)))
  });
  return (
    <Pressable
      disabled={!onTap && !onLongTap}
      onPress={(e) => {
        const p = norm(e);
        onTap?.(p.x, p.y);
      }}
      onLongPress={(e) => {
        const p = norm(e);
        onLongTap?.(p.x, p.y);
      }}
      onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ width: width ?? '100%', aspectRatio: aspect, backgroundColor: '#000' }}
    >
      {frame ? (
        <Image source={{ uri: `data:image/jpeg;base64,${frame.data}` }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" fadeDuration={0} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.accent} />
        </View>
      )}
      {pos && box.w > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: pos.x * box.w - 3, top: pos.y * box.h - 2 }}>
          <CursorArrow />
        </View>
      )}
    </Pressable>
  );
}
