import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, ChevronRight, ClipboardPaste, MessageSquare, Presentation, Square, Upload } from 'lucide-react-native';
import type { KeyName } from '@fristy/protocol';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemoteAction } from '../connection/hooks';
import { Button, Card, ErrorText, Input, Muted, Title, haptic } from '../components/ui';

export function ToolsScreen() {
  const { t } = useApp();
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
      <Title>{t('nav.tools')}</Title>
      <ClipboardCard />
      <MessageCard />
      <PresentationCard />
    </ScrollView>
  );
}

function ClipboardCard() {
  const { c, t, row } = useApp();
  const can = useCan('clipboard');
  const conn = useConnection();
  const act = useRemoteAction();
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  if (conn.status === 'online' && !can) {
    return (
      <Card title={t('tools.clipboard')}>
        <Muted>{`${t('perm.clipboard')} – ${t('common.disabled')}. The PC owner can grant it in FRISTY Remote → Devices.`}</Muted>
      </Card>
    );
  }
  return (
    <Card title={t('tools.clipboard')} right={<ClipboardPaste color={c.accent} size={20} />}>
      <Input value={text} onChangeText={setText} placeholder={t('input.typeHere')} multiline style={{ height: 90, paddingTop: 12, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.md }}>
        <Button
          style={{ flex: 1 }}
          icon={<Upload color="#fff" size={16} />}
          label={t('tools.sendToPc')}
          busy={act.busy}
          onPress={async () => {
            // Empty box → send whatever is on the phone's clipboard.
            const value = text || (await Clipboard.getStringAsync());
            if (!value) return;
            const ok = await act.run(() => connection.call('clipboard.set', { text: value.slice(0, 10_000) }));
            if (ok) setNote(t('tools.sent'));
          }}
        />
        <Button
          style={{ flex: 1 }}
          variant="ghost"
          label={t('tools.getFromPc')}
          onPress={async () => {
            const r = await act.run(() => connection.call('clipboard.get', {}));
            if (!r) return;
            setText(r.text);
            await Clipboard.setStringAsync(r.text);
            setNote(t('tools.copied'));
          }}
        />
      </View>
      {note && <Muted>{note}</Muted>}
      <ErrorText>{act.error}</ErrorText>
    </Card>
  );
}

function MessageCard() {
  const { c, t, row } = useApp();
  const can = useCan('apps');
  const act = useRemoteAction();
  const [text, setText] = useState('');
  const [speak, setSpeak] = useState(true);
  const [sent, setSent] = useState(false);
  if (!can) return null;
  return (
    <Card title={t('tools.message')} right={<MessageSquare color={c.accent} size={20} />}>
      <Input value={text} onChangeText={(v) => (setText(v), setSent(false))} placeholder="🍕" maxLength={300} />
      <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
        <Text style={{ color: c.text }}>{t('tools.speak')}</Text>
        <Switch value={speak} onValueChange={setSpeak} trackColor={{ true: c.accent, false: c.cardBorder }} thumbColor="#fff" />
      </View>
      <Button
        style={{ marginTop: spacing.sm }}
        label={sent ? t('tools.sent') : t('tools.send')}
        disabled={!text.trim()}
        busy={act.busy}
        onPress={async () => {
          const ok = await act.run(() => connection.call('system.message', { text: text.trim(), speak }));
          if (ok) setSent(true);
        }}
      />
      <ErrorText>{act.error}</ErrorText>
    </Card>
  );
}

function PresentationCard() {
  const { c, t, row, prefs } = useApp();
  const conn = useConnection();
  const can = useCan('input') && (conn.accepted?.host.inputEnabled ?? false);
  if (!can) return null;
  const key = (k: KeyName, mods: ('shift' | 'ctrl' | 'alt' | 'win')[] = []) => {
    haptic(prefs.haptics, 'medium');
    connection.notify('input.key', { key: k, modifiers: mods });
  };
  const big = (label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, height: 130, borderRadius: radius.xl, backgroundColor: pressed ? c.accentStrong : c.accent, alignItems: 'center', justifyContent: 'center', gap: 6 })}
    >
      {icon}
      <Text style={{ color: '#fff', fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
  return (
    <Card title={t('tools.presentation')} right={<Presentation color={c.accent} size={20} />}>
      <View style={{ flexDirection: row, gap: spacing.md }}>
        {big('◀', <ChevronLeft color="#fff" size={44} />, () => key('left'))}
        {big('▶', <ChevronRight color="#fff" size={44} />, () => key('right'))}
      </View>
      <View style={{ flexDirection: row, gap: spacing.sm, marginTop: spacing.md }}>
        <Button style={{ flex: 1 }} variant="subtle" label={t('tools.start')} onPress={() => key('f5')} />
        <Button style={{ flex: 1 }} variant="subtle" icon={<Square color={c.text} size={14} fill={c.text} />} label={t('tools.black')} onPress={() => key('b')} />
        <Button style={{ flex: 1 }} variant="subtle" label={t('tools.end')} onPress={() => key('escape')} />
      </View>
      <Text style={{ color: c.textFaint, fontSize: font.tiny, marginTop: spacing.sm }}>PowerPoint · Google Slides · PDF viewers</Text>
    </Card>
  );
}
