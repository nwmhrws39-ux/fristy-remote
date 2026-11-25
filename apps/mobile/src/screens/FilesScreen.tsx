import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, File as FileIcon, Folder, Image as ImageIcon, MonitorPlay, Pause, Play, Share2, X } from 'lucide-react-native';
import { OPENABLE_EXTENSIONS, type FileItem, type SharedRoot } from '@fristy/protocol';
import { formatBytes } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { useApp } from '../theme';
import { connection } from '../connection/manager';
import { useCan, useConnection, useRemote, useRemoteAction } from '../connection/hooks';
import { cancelTransfer, pauseTransfer, startDownload, startUpload, transferStore, type LocalTransfer } from '../connection/transfers';
import { Button, Card, ErrorText, Muted, NotAllowed, Pill, Title } from '../components/ui';

export function FilesScreen() {
  const { c, t, row } = useApp();
  const conn = useConnection();
  const can = useCan('files');
  const roots = useRemote('files.roots', {}, can);
  const act = useRemoteAction();
  const [root, setRoot] = useState<SharedRoot | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const transfers = useSyncExternalStore(transferStore.subscribe, transferStore.get);

  const load = async () => {
    if (!root) return;
    setLoading(true);
    const r = await act.run(() => connection.call('files.list', { rootId: root.id, path: path.join('/') }));
    if (r) setItems(r);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root?.id, path.join('/')]);

  if (conn.status === 'online' && !can) return <View style={{ padding: spacing.lg }}><Title>{t('nav.files')}</Title><NotAllowed permission="files" /></View>;

  const upload = async (kind: 'media' | 'file') => {
    if (!root) return;
    if (kind === 'media') {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 1 });
      if (res.canceled) return;
      for (const a of res.assets) void startUpload(root.id, path.join('/'), a.uri, a.fileName ?? `media-${Date.now()}.${a.type === 'video' ? 'mp4' : 'jpg'}`, a.fileSize ?? 0).then(load);
    } else {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (res.canceled) return;
      for (const a of res.assets) void startUpload(root.id, path.join('/'), a.uri, a.name, a.size ?? 0).then(load);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={loading || roots.loading} onRefresh={() => void (root ? load() : roots.reload())} tintColor={c.accent} />}>
      <Title>{t('nav.files')}</Title>
      <ErrorText>{act.error || roots.error}</ErrorText>

      {!root && (
        <Card title={t('settings.sharedFolders')}>
          {roots.data?.length === 0 && <Muted>{t('files.noRoots')}</Muted>}
          {roots.data?.map((r) => (
            <Pressable key={r.id} onPress={() => (setRoot(r), setPath([]), setItems(null))} style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 12 }}>
              <Folder color={c.accent} size={22} />
              <Text style={{ color: c.text, flex: 1, fontWeight: '700' }}>{r.name}</Text>
              {!r.writable && <Pill>{t('files.readOnly')}</Pill>}
            </Pressable>
          ))}
        </Card>
      )}

      {root && (
        <Card
          title={[root.name, ...path].join(' / ')}
          right={
            <Pressable onPress={() => (path.length ? setPath(path.slice(0, -1)) : (setRoot(null), setItems(null)))} hitSlop={10} accessibilityLabel="Back">
              <ChevronLeft color={c.accent} size={24} />
            </Pressable>
          }
        >
          {root.writable && (
            <View style={{ flexDirection: row, gap: spacing.sm, marginBottom: spacing.md }}>
              <Button style={{ flex: 1 }} variant="subtle" icon={<ImageIcon color={c.text} size={16} />} label="Photos" onPress={() => void upload('media')} />
              <Button style={{ flex: 1 }} variant="subtle" icon={<ArrowUpFromLine color={c.text} size={16} />} label={t('files.upload')} onPress={() => void upload('file')} />
            </View>
          )}
          {items?.length === 0 && <Muted>{t('common.none')}</Muted>}
          {items?.map((it) => (
            <Pressable
              key={it.name}
              onPress={() => (it.dir ? setPath([...path, it.name]) : void act.run(() => startDownload(root.id, [...path, it.name].join('/'))))}
              style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingVertical: 10 }}
            >
              {it.dir ? <Folder color={c.accent} size={20} /> : <FileIcon color={c.textMuted} size={20} />}
              <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>
                {it.name}
              </Text>
              {!it.dir && <Text style={{ color: c.textFaint, fontSize: font.tiny }}>{formatBytes(it.size)}</Text>}
              {!it.dir && (OPENABLE_EXTENSIONS as readonly string[]).includes(it.name.split('.').pop()?.toLowerCase() ?? '') && (
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={t('files.openOnPc')}
                  onPress={() => void act.run(() => connection.call('files.open', { rootId: root.id, path: [...path, it.name].join('/') }))}
                  style={{ paddingHorizontal: 6 }}
                >
                  <MonitorPlay color={c.accent} size={18} />
                </Pressable>
              )}
              {!it.dir && <ArrowDownToLine color={c.textMuted} size={16} />}
            </Pressable>
          ))}
        </Card>
      )}

      <Card title={t('files.history')}>
        {transfers.length === 0 && <Muted>{t('common.none')}</Muted>}
        {transfers.map((tr) => (
          <TransferRow key={tr.id} tr={tr} />
        ))}
      </Card>
    </ScrollView>
  );
}

function TransferRow({ tr }: { tr: LocalTransfer }) {
  const { c, t, row } = useApp();
  const pct = tr.size ? Math.round((tr.done / tr.size) * 100) : 100;
  const media = tr.mime?.startsWith('image/') || tr.mime?.startsWith('video/');
  const [saved, setSaved] = useState(false);
  return (
    <View style={{ paddingVertical: 10 }}>
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
        {tr.direction === 'upload' ? <ArrowUpFromLine color={c.accent} size={16} /> : <ArrowDownToLine color={c.success} size={16} />}
        <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>
          {tr.name}
        </Text>
        {(tr.status === 'active' || tr.status === 'paused') && (
          <>
            <Pressable onPress={() => pauseTransfer(tr.id, tr.status === 'active')} hitSlop={8} accessibilityLabel={tr.status === 'active' ? t('files.pause') : t('files.resume')}>
              {tr.status === 'active' ? <Pause color={c.textMuted} size={18} /> : <Play color={c.textMuted} size={18} />}
            </Pressable>
            <Pressable onPress={() => cancelTransfer(tr.id)} hitSlop={8} accessibilityLabel={t('common.cancel')}>
              <X color={c.danger} size={18} />
            </Pressable>
          </>
        )}
        {tr.status === 'completed' && tr.direction === 'download' && tr.localUri && (
          <Pressable
            hitSlop={8}
            accessibilityLabel="Share"
            onPress={async () => {
              if (media && !saved) {
                const perm = await MediaLibrary.requestPermissionsAsync(true);
                if (perm.granted) {
                  await MediaLibrary.saveToLibraryAsync(tr.localUri!);
                  setSaved(true);
                  return;
                }
              }
              if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(tr.localUri!);
            }}
          >
            <Share2 color={c.accent} size={18} />
          </Pressable>
        )}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.cardBorder, marginTop: 6, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 6, backgroundColor: tr.status === 'failed' ? c.danger : tr.status === 'completed' ? c.success : c.accent }} />
      </View>
      <Text style={{ color: c.textFaint, fontSize: font.tiny, marginTop: 4 }}>
        {formatBytes(tr.done)} / {formatBytes(tr.size)} · {saved ? 'saved to gallery' : tr.status}
        {tr.error ? ` – ${tr.error}` : ''}
      </Text>
    </View>
  );
}

