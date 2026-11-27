import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { currentVersion, updateStore } from './updates';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Download, KeyRound, Lock, Ticket, Wrench, X } from 'lucide-react-native';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { adminLogin, ownerStore, redeemInvite } from './owner';
import { readJson, writeJson } from '../store/secure';
import { Button, ErrorText, Input, Logo, Muted } from '../components/ui';

export function useOwner() {
  return useSyncExternalStore(ownerStore.subscribe, ownerStore.get);
}

/** Small, unobtrusive key button → code dialog. The code is verified by the owner service only. */
export function AdminKey({ onSuccess, size = 16, label }: { onSuccess?: () => void; size?: number; label?: string }) {
  const { c, t } = useApp();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {label ? (
        <Button label={label} icon={<KeyRound color="#fff" size={16} />} onPress={() => setOpen(true)} />
      ) : (
        <Pressable onPress={() => setOpen(true)} hitSlop={12} accessibilityLabel={t('owner.code')} style={{ opacity: 0.35, padding: 6 }}>
          <KeyRound color={c.textFaint} size={size} />
        </Pressable>
      )}
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

const fmtTime = (ts: number, lang: string) =>
  new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : undefined, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function LockScreen() {
  const { c, t, prefs } = useApp();
  const lang = prefs.language;
  const o = useOwner();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = o.reason === 'invite';
  const maint = o.reason === 'maintenance' || (!o.locked && !!o.maintenance);
  const tone = invite ? c.accent : maint ? c.warning : c.danger;
  const Icon = invite ? Ticket : maint ? Wrench : Lock;
  const title = invite ? t('owner.inviteTitle') : maint ? t('owner.maintTitle') : o.reason === 'blocked' ? t('owner.blocked') : t('owner.locked');
  const body = invite
    ? t('owner.inviteBody')
    : maint && o.maintenance
      ? `${t('owner.maintActive', { end: fmtTime(o.maintenance.end, lang) })}${o.message ? `\n${o.message}` : ''}`
      : o.message || t('owner.lockedHint');
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: tone + '22', padding: 24, borderRadius: 99 }}>
        <Icon color={tone} size={48} />
      </View>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '900', textAlign: 'center' }}>{title}</Text>
      <Muted center>{body}</Muted>
      {invite && (
        <View style={{ alignSelf: 'stretch', gap: spacing.md }}>
          <Input
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            placeholder="ABCD2345"
            style={{ textAlign: 'center', fontSize: 22, letterSpacing: 4, fontWeight: '800' }}
          />
          <ErrorText>{error}</ErrorText>
          <Button
            big
            label={t('owner.inviteEnter')}
            busy={busy}
            disabled={code.trim().length < 4}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await redeemInvite(code);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      )}
      <View style={{ marginTop: spacing.xl }}>
        <AdminKey />
      </View>
    </ScrollView>
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

const K_SEEN = 'fristy.personalSeen.v1';

export function OwnerBanners() {
  const { c, t, prefs } = useApp();
  const lang = prefs.language;
  const o = useOwner();
  const [hidden, setHidden] = useState<string | null>(null);
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    void readJson<number>(K_SEEN, 0).then(setSeen);
  }, []);
  const m = o.maintenance && o.maintenance.start > Date.now() ? o.maintenance : null;
  const personal = seen !== null && o.personal && o.personal.at > seen ? o.personal : null;
  if (!o.announcement && !o.updateAvailable && !m && !personal) return null;
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
      {m && (
        <View style={{ backgroundColor: c.warning + '22', borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ color: c.warning, fontWeight: '700' }}>🔧 {t('owner.maintUpcoming', { start: fmtTime(m.start, lang), end: fmtTime(m.end, lang) })}</Text>
          {!!m.message && <Text style={{ color: c.textMuted, marginTop: 4 }}>{m.message}</Text>}
        </View>
      )}
      {personal && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, backgroundColor: c.accentSoft, borderColor: c.accent + '66', borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.accent, fontWeight: '800', fontSize: font.tiny }}>✉️ {t('owner.messageFromOwner')}</Text>
            <Text style={{ color: c.text, marginTop: 4 }}>{personal.text}</Text>
          </View>
          <Pressable
            hitSlop={10}
            accessibilityLabel={t('common.close')}
            onPress={() => {
              setSeen(personal.at);
              void writeJson(K_SEEN, personal.at);
            }}
          >
            <X color={c.textMuted} size={18} />
          </Pressable>
        </View>
      )}
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
