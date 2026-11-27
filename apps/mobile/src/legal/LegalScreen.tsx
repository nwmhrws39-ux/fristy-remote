import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { ExternalLink, ShieldCheck } from 'lucide-react-native';
import { LEGAL_CONTRACT_DOCS, LEGAL_DOCS, LEGAL_NOTICE_DOCS, LEGAL_VERSION, legalUrl, type LegalDocId } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { Button, Logo, Muted } from '../components/ui';
import { acceptLegal, legalStore } from './legal';
import { resumeOwner } from '../admin/owner';

export function useLegal() {
  return useSyncExternalStore(legalStore.subscribe, legalStore.get);
}

export function DocLink({ id }: { id: LegalDocId }) {
  const { c, prefs } = useApp();
  const d = LEGAL_DOCS.find((x) => x.id === id)!;
  return (
    <Pressable onPress={() => void Linking.openURL(legalUrl(id, prefs.language))} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityRole="link">
      <Text style={{ color: c.accent, fontWeight: '700' }}>{prefs.language === 'he' ? d.he : d.en}</Text>
      <ExternalLink color={c.accent} size={12} />
    </Pressable>
  );
}

function Check({ value, onChange, children }: { value: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const { c, row } = useApp();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      style={{ flexDirection: row, gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: value ? c.accent : c.cardBorder, backgroundColor: c.card }}
    >
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.cardBorder }} thumbColor="#fff" />
      <Text style={{ color: c.text, flex: 1 }}>{children}</Text>
    </Pressable>
  );
}

/**
 * Mandatory legal onboarding on the phone. Nothing is pre-selected and
 * nothing is sent to the owner service before acceptance.
 */
export function LegalScreen() {
  const { c, t, row } = useApp();
  const previous = useLegal();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.xl, paddingTop: 70, gap: spacing.lg }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md }}>
        <Logo size={48} />
        <Text style={{ color: c.text, fontSize: font.title, fontWeight: '900', flex: 1 }}>{t('legal.title')}</Text>
      </View>
      {previous && previous.version !== LEGAL_VERSION && <Text style={{ color: c.warning, fontWeight: '700' }}>{t('legal.updated', { v: LEGAL_VERSION })}</Text>}
      <Muted>{t('legal.intro')}</Muted>
      <View style={{ flexDirection: row, flexWrap: 'wrap', gap: spacing.md }}>
        {[...LEGAL_CONTRACT_DOCS, ...LEGAL_NOTICE_DOCS].map((id) => (
          <DocLink key={id} id={id} />
        ))}
      </View>
      <View style={{ flexDirection: row, gap: spacing.md, backgroundColor: c.accentSoft, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.accent + '55' }}>
        <ShieldCheck color={c.accent} size={20} />
        <Text style={{ color: c.text, flex: 1 }}>{t('legal.privacyNoticePhone')}</Text>
      </View>
      <Check value={accepted} onChange={setAccepted}>
        {t('legal.acceptBox')}
      </Check>
      <Button
        big
        label={t('legal.continue')}
        disabled={!accepted}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await acceptLegal();
            resumeOwner();
          } finally {
            setBusy(false);
          }
        }}
      />
      <Text style={{ color: c.textFaint, fontSize: font.tiny, textAlign: 'center' }}>
        {t('legal.draft')} · v{LEGAL_VERSION}
      </Text>
    </ScrollView>
  );
}
