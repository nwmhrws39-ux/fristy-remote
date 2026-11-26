import { useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { currentVersion, updateStore } from './updates';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Download, KeyRound, Lock } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { adminLogin, ownerStore } from './owner';
import { Button, ErrorText, Input, Logo, Muted } from '../components/ui';

export function useOwner() {
  return useSyncExternalStore(ownerStore.subscribe, ownerStore.get);
}

/** Small, unobtrusive key button → code dialog. The code is verified by the owner service only. */
export function AdminKey({ onSuccess, size = 16 }: { onSuccess?: () => void; size?: number }) {
  const { c, t } = useApp();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={12} accessibilityLabel={t('owner.code')} style={{ opacity: 0.35, padding: 6 }}>
        <KeyRound color={c.textFaint} size={size} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: spacing.xl }}>
          <View style={{ backgroundColor: c.bgElevated, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: c.cardBorder, gap: spacing.md }}>
            <Text style={{ color: c.text, fontSize: font.h1, fontWeight: '800' }}>{t('owner.code')}</Text>
            <Input value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="••••••" />
            <ErrorText>{error}</ErrorText>
            <Button
              label={t('owner.enter')}
              busy={busy}
              disabled={!code}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await adminLogin(code);
                  setOpen(false);
                  setCode('');
                  onSuccess?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => (setOpen(false), setCode(''), setError(null))} />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function LockScreen() {
  const { c, t } = useApp();
  const o = useOwner();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ backgroundColor: c.danger + '22', padding: 24, borderRadius: 99 }}>
        <Lock color={c.danger} size={48} />
      </View>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '900', textAlign: 'center' }}>{o.reason === 'blocked' ? t('owner.blocked') : t('owner.locked')}</Text>
      <Muted center>{o.message || t('owner.lockedHint')}</Muted>
      <View style={{ position: 'absolute', bottom: 40 }}>
        <AdminKey />
      </View>
    </View>
  );
}

export function WelcomeName({ onDone }: { onDone: (name: string) => void }) {
  const { c, t } = useApp();
  const [name, setName] = useState('');
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center' }}>
        <Logo size={64} />
      </View>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '900', textAlign: 'center' }}>{t('owner.nameTitle')}</Text>
      <Input value={name} onChangeText={setName} placeholder={t('owner.yourName')} maxLength={40} autoFocus />
      <View style={{ backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.cardBorder }}>
        <Muted>{t('owner.notice')}</Muted>
      </View>
      <Button big label={t('owner.continue')} disabled={!name.trim()} onPress={() => onDone(name.trim())} />
    </ScrollView>
  );
}

export function OwnerBanners() {
  const { c, t } = useApp();
  const o = useOwner();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!o.announcement && !o.updateAvailable) return null;
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
      {o.announcement && hidden !== o.announcement && (
        <Pressable onPress={() => setHidden(o.announcement)} style={{ backgroundColor: c.accentSoft, borderColor: c.accent + '66', borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ color: c.text }}>📢 {o.announcement}</Text>
        </Pressable>
      )}
      {o.updateAvailable && (
        <View style={{ backgroundColor: c.warning + '22', borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ color: c.warning, fontWeight: '700' }}>⬆️ {t('owner.update')}</Text>
        </View>
      )}
    </View>
  );
}

export function useUpdate() {
  return useSyncExternalStore(updateStore.subscribe, updateStore.get);
}

/** Shown instead of the app when a newer iPhone version exists (mandatory updates). */
export function UpdateRequiredScreen() {
  const { c, t } = useApp();
  const u = useUpdate();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ backgroundColor: c.accentSoft, padding: 24, borderRadius: 99 }}>
        <Download color={c.accent} size={48} />
      </View>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '900', textAlign: 'center' }}>{t('update.required')}</Text>
      <Muted center>{t('update.requiredPhone', { v: u.latest ?? '' })}</Muted>
      <Text style={{ color: c.textFaint, fontSize: font.tiny }}>
        {currentVersion()} → {u.latest}
      </Text>
      {u.url && <Button label={t('update.download')} onPress={() => void Linking.openURL(u.url!)} />}
    </View>
  );
}
