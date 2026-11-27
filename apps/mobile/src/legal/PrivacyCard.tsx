import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { LEGAL_DOCS, REPORT_CATEGORIES, legalUrl, type ReportCategory, type StringKey } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { deleteMyData, exportMyData, ownerEnabled, sendReport, stopOwner } from '../admin/owner';
import { forgetHost, loadHosts } from '../store/hosts';
import { Button, Card, ErrorText, Input, Muted } from '../components/ui';
import { DocLink, useLegal } from './LegalScreen';
import { legalHistory, withdrawLegal } from './legal';

async function shareJson(name: string, data: unknown) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name });
}

/** Settings → Privacy: legal documents, export, deletion, withdraw & reset, report a problem. */
export function PrivacyCard({ onReset }: { onReset: () => void }) {
  const { c, t, prefs, setPrefs } = useApp();
  const legal = useLegal();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportAll = () =>
    run(async () => {
      const hosts = (await loadHosts()).map(({ pk: _pk, ...h }) => h); // no keys
      const server = ownerEnabled ? await exportMyData().catch((e: Error) => ({ error: e.message })) : null;
      await shareJson('fristy-remote-phone-data.json', {
        exportedAt: new Date().toISOString(),
        app: 'FRISTY Remote (phone)',
        legal: { current: legal, history: await legalHistory() },
        preferences: prefs,
        pairedComputers: hosts,
        ownerService: server
      });
    });

  return (
    <Card title={`🔒 ${t('privacy.title')}`}>
      {legal && <Muted>{t('legal.acceptedOn', { v: legal.version, date: new Date(legal.acceptedAt).toLocaleString(prefs.language === 'he' ? 'he-IL' : undefined) })}</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.md }}>
        {LEGAL_DOCS.map((d) => (
          <DocLink key={d.id} id={d.id} />
        ))}
      </View>
      <View style={{ gap: spacing.sm }}>
        <Button variant="ghost" label={t('privacy.exportPhone')} onPress={() => void exportAll()} />
        {ownerEnabled && (
          <Button
            variant="ghost"
            label={t('privacy.deleteRemote')}
            onPress={() =>
              Alert.alert(t('privacy.deleteRemote'), t('privacy.deleteRemoteConfirmPhone'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => deleteMyData(), t('privacy.deleted')) }
              ])
            }
          />
        )}
        {ownerEnabled && <Button variant="ghost" label={t('privacy.report')} onPress={() => setReporting(true)} />}
        <Button variant="ghost" label={`↗ ${t('privacy.deleteAccountPage')}`} onPress={() => void Linking.openURL(legalUrl('delete-account', prefs.language))} />
        <Button
          variant="danger"
          label={t('privacy.withdraw')}
          onPress={() =>
            Alert.alert(t('privacy.withdraw'), t('privacy.withdrawConfirmPhone'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('privacy.withdraw'),
                style: 'destructive',
                onPress: () =>
                  void run(async () => {
                    connection.disconnect();
                    for (const h of await loadHosts()) await forgetHost(h.pk);
                    stopOwner();
                    setPrefs({ userName: '' });
                    await withdrawLegal();
                    onReset();
                  })
              }
            ])
          }
        />
      </View>
      {note && <Text style={{ color: c.success, marginTop: spacing.sm }}>{note}</Text>}
      <ErrorText>{error}</ErrorText>
      <ReportDialog visible={reporting} onClose={() => setReporting(false)} />
    </Card>
  );
}

function ReportDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, t } = useApp();
  const [category, setCategory] = useState<ReportCategory>('unauthorized-access');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setDone(false);
    setMessage('');
    setContact('');
    setError(null);
    onClose();
  };
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: spacing.lg }}>
        <View style={{ backgroundColor: c.bgElevated, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: c.cardBorder }}>
          <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '800' }}>{t('privacy.report')}</Text>
          {done ? (
            <Text style={{ color: c.success }}>{t('privacy.sent')}</Text>
          ) : (
            <>
              <Muted>{t('privacy.reportHint')}</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {REPORT_CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: category === cat ? c.accent : c.card }}
                  >
                    <Text style={{ color: category === cat ? '#fff' : c.text, fontSize: font.tiny, fontWeight: '700' }}>{t(`privacy.cat.${cat}` as StringKey)}</Text>
                  </Pressable>
                ))}
              </View>
              <Input value={message} onChangeText={setMessage} placeholder={t('privacy.message')} multiline maxLength={1000} style={{ height: 100, paddingTop: 12, textAlignVertical: 'top' }} />
              <Input value={contact} onChangeText={setContact} placeholder={t('privacy.contact')} maxLength={200} autoCapitalize="none" />
              <ErrorText>{error}</ErrorText>
              <Button
                label={t('privacy.send')}
                busy={busy}
                disabled={message.trim().length < 5}
                onPress={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await sendReport(category, message.trim(), contact.trim() || undefined);
                    setDone(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </>
          )}
          <Button variant="ghost" label={t('common.close')} onPress={close} />
        </View>
      </View>
    </Modal>
  );
}
