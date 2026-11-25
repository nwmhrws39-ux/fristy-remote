import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Keyboard as KeyboardIcon, Monitor, QrCode, Radar } from 'lucide-react-native';
import { decodePairingQr } from '@fristy/protocol';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { pair, targetFromQr, type PairTarget } from '../connection/manager';
import { discoverHosts, udpAvailable, type DiscoveredHost } from '../connection/udp';
import type { PairedHost } from '../store/hosts';
import { Button, Card, ErrorText, Input, Logo, Muted, Title } from '../components/ui';

type Mode = 'menu' | 'scan' | 'manual' | 'waiting';

export function PairScreen({ onPaired, onCancel }: { onPaired: (h: PairedHost) => void; onCancel?: () => void }) {
  const { c, t, row } = useApp();
  const [mode, setMode] = useState<Mode>('menu');
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  // The camera reports the same QR many times per second, faster than React re-renders.
  // A ref guarantees exactly one pairing attempt (pairing codes are single-use).
  const busy = useRef(false);

  const start = async (target: PairTarget) => {
    if (busy.current) return;
    busy.current = true;
    setMode('waiting');
    setSas(null);
    setError(null);
    try {
      onPaired(await pair(target, setSas));
    } catch (e) {
      setError((e as Error).message);
      setMode('menu');
      setScanned(false);
    } finally {
      busy.current = false;
    }
  };

  if (mode === 'waiting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        {sas ? (
          <>
            <Text style={{ color: c.text, fontSize: font.h1, fontWeight: '800', marginBottom: spacing.md }}>{t('pair.waiting')}</Text>
            <Muted center>{t('pair.verify')}</Muted>
            <Text style={{ color: c.text, fontSize: 44, fontWeight: '800', letterSpacing: 8, marginTop: spacing.lg, fontVariant: ['tabular-nums'] }}>
              {sas.slice(0, 3)} {sas.slice(3)}
            </Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={c.accent} size="large" />
            <Text style={{ color: c.textMuted, marginTop: spacing.md }}>{t('common.connecting')}</Text>
          </>
        )}
      </View>
    );
  }

  if (mode === 'scan') {
    if (!perm?.granted) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
          <Muted center>FRISTY Remote needs the camera only to scan the pairing QR code.</Muted>
          <Button label={t('common.confirm')} onPress={() => void requestPerm()} />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setMode('menu')} />
        </View>
      );
    }
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={
            scanned
              ? undefined
              : ({ data }) => {
                  if (busy.current) return;
                  const qr = decodePairingQr(data);
                  if (!qr) return;
                  setScanned(true);
                  if (qr.exp < Date.now()) {
                    setError('This pairing code has expired. Generate a new one on your PC.');
                    setMode('menu');
                    setScanned(false);
                    return;
                  }
                  void start(targetFromQr(qr));
                }
          }
        />
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 250, height: 250, borderRadius: radius.xl, borderWidth: 3, borderColor: c.accent }} />
          <Text style={{ color: '#fff', marginTop: spacing.lg, fontWeight: '700' }}>{t('pair.scan')}</Text>
        </View>
        <View style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}>
          <Button variant="subtle" label={t('common.cancel')} onPress={() => setMode('menu')} />
        </View>
      </View>
    );
  }

  if (mode === 'manual') return <ManualPair onStart={start} onBack={() => setMode('menu')} />;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: 72 }}>
      <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
        <Logo size={72} />
        <Text style={{ color: c.text, fontSize: 30, fontWeight: '900', letterSpacing: 6, marginTop: spacing.lg }}>FRISTY</Text>
        <Text style={{ color: c.accent, fontSize: font.small, fontWeight: '800', letterSpacing: 8 }}>REMOTE</Text>
        <Muted center>{t('app.tagline')}</Muted>
      </View>
      <Title sub="Open FRISTY Remote on your Windows PC and click “Generate pairing code”.">{t('pair.title')}</Title>
      <ErrorText>{error}</ErrorText>
      <Pressable onPress={() => setMode('scan')}>
        <Card style={{ flexDirection: row, alignItems: 'center', gap: spacing.lg }}>
          <View style={{ backgroundColor: c.accentSoft, padding: 14, borderRadius: radius.md }}>
            <QrCode color={c.accent} size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '700' }}>{t('pair.scan')}</Text>
            <Muted>Fastest and most secure.</Muted>
          </View>
        </Card>
      </Pressable>
      <Pressable onPress={() => setMode('manual')}>
        <Card style={{ flexDirection: row, alignItems: 'center', gap: spacing.lg }}>
          <View style={{ backgroundColor: c.accentSoft, padding: 14, borderRadius: radius.md }}>
            <KeyboardIcon color={c.accent} size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '700' }}>{t('pair.manual')}</Text>
            <Muted>{t('pair.codeHint')}</Muted>
          </View>
        </Card>
      </Pressable>
      {onCancel && <Button variant="ghost" label={t('common.cancel')} onPress={onCancel} />}
    </ScrollView>
  );
}

function ManualPair({ onStart, onBack }: { onStart: (t: PairTarget) => void; onBack: () => void }) {
  const { c, t, row } = useApp();
  const [hosts, setHosts] = useState<DiscoveredHost[] | null>(null);
  const [selected, setSelected] = useState<DiscoveredHost | null>(null);
  const [ip, setIp] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async (target?: string) => {
    setBusy(true);
    setError(null);
    try {
      const found = await discoverHosts(2500, target);
      setHosts(found);
      if (found.length === 1) setSelected(found[0]!);
      if (target && !found.length) setError('No FRISTY Remote PC answered at that address.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8);
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: 64 }} keyboardShouldPersistTaps="handled">
      <Title sub={t('pair.codeHint')}>{t('pair.manual')}</Title>
      {!udpAvailable() && <ErrorText>LAN discovery needs the FRISTY build of the app (not Expo Go). Use QR pairing instead.</ErrorText>}
      <Card title={t('pair.discovered')} right={busy ? <ActivityIndicator color={c.accent} /> : <Pressable onPress={() => void scan()}><Radar color={c.accent} size={22} /></Pressable>}>
        {hosts === null && <Button variant="ghost" label={t('common.search')} onPress={() => void scan()} busy={busy} />}
        {hosts?.length === 0 && <Muted>{t('pair.noneFound')}</Muted>}
        {hosts?.map((h) => (
          <Pressable key={h.pk} onPress={() => setSelected(h)}>
            <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: selected?.pk === h.pk ? c.accent : c.cardBorder, marginBottom: spacing.sm }}>
              <Monitor color={selected?.pk === h.pk ? c.accent : c.textMuted} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700' }}>{h.name}</Text>
                <Muted>
                  {h.address} {h.pairing ? '' : '· no active pairing code'}
                </Muted>
              </View>
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.sm }}>
          <Input style={{ flex: 1 }} placeholder={t('pair.address')} value={ip} onChangeText={setIp} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
          <Button variant="ghost" label="↻" disabled={!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)} onPress={() => void scan(ip)} />
        </View>
      </Card>
      <Card title={t('pair.manual')}>
        <Input
          value={normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="XXXX-XXXX"
          style={{ fontSize: 26, height: 60, letterSpacing: 6, textAlign: 'center', fontWeight: '800' }}
        />
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button
        big
        label={t('common.confirm')}
        disabled={!selected || !selected.pairing || !selected.pid || normalized.length !== 8}
        onPress={() =>
          onStart({
            pk: selected!.pk,
            pid: selected!.pid!,
            name: selected!.name,
            hosts: [selected!.address],
            port: selected!.port,
            proof: { code: normalized }
          })
        }
      />
      <Button variant="ghost" style={{ marginTop: spacing.sm }} label={t('common.cancel')} onPress={onBack} />
    </ScrollView>
  );
}
