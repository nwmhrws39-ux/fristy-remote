import { ArrowDownToLine, ArrowUpFromLine, FolderLock, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { formatBytes } from '@fristy/shared/src/format';
import { invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction, useIpc } from '../lib/hooks';
import { Badge, Button, Card, Empty, ErrorNote, Field, inputClass } from '../components/ui';

interface Folder {
  id: string;
  name: string;
  path: string;
  writable: boolean;
}
interface Transfer {
  id: string;
  deviceId: string;
  direction: 'upload' | 'download';
  name: string;
  size: number;
  transferred: number;
  status: string;
  startedAt: number;
}

export function Files({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const folders = useIpc<Folder[]>('folders.list');
  const transfers = useIpc<Transfer[]>('transfers.list', undefined, [state.sessions.length]);
  const act = useAction();
  const deviceName = (id: string) => state.devices.find((d) => d.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.files')}</h1>
          <p className="mt-1 text-sm text-muted">Phones can only see folders you share here. System folders and whole drives cannot be shared.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<FolderLock className="size-4" />} onClick={() => void act.run(() => invoke('folders.addDialog', { writable: false })).then(folders.reload)}>
            {t('files.readOnly')}
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => void act.run(() => invoke('folders.addDialog', { writable: true })).then(folders.reload)}>
            {t('settings.sharedFolders')}
          </Button>
        </div>
      </header>
      <ErrorNote>{act.error}</ErrorNote>

      <Card title={t('settings.sharedFolders')}>
        {folders.data?.length === 0 && <Empty icon={<FolderOpen className="size-10" />}>{t('files.noRoots')}</Empty>}
        <div className="divide-y divide-line">
          {folders.data?.map((f) => (
            <div key={f.id} className="flex items-center gap-3 py-3">
              <FolderOpen className="size-5 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{f.name}</div>
                <div className="truncate text-xs text-faint" dir="ltr">
                  {f.path}
                </div>
              </div>
              <Badge tone={f.writable ? 'warn' : 'neutral'}>{f.writable ? 'Read & write' : t('files.readOnly')}</Badge>
              <button className="rounded-xl p-2 text-faint hover:text-bad" onClick={() => void invoke('folders.remove', { id: f.id }).then(folders.reload)} aria-label="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 max-w-xs">
          <Field label={t('settings.transferLimit')}>
            <input
              type="number"
              min={1}
              max={20000}
              className={inputClass}
              defaultValue={state.settings.maxTransferMB}
              onBlur={(e) => void act.run(() => invoke('settings.update', { maxTransferMB: Math.max(1, Math.min(20000, Number(e.target.value) || 1)) }))}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('files.history')} action={<Button variant="ghost" onClick={() => void transfers.reload()}>↻</Button>}>
        {transfers.data?.length === 0 && <Empty>{t('common.none')}</Empty>}
        <div className="divide-y divide-line">
          {transfers.data?.map((x) => (
            <div key={x.id} className="flex items-center gap-3 py-2.5 text-sm">
              {x.direction === 'upload' ? <ArrowUpFromLine className="size-4 text-accent" /> : <ArrowDownToLine className="size-4 text-ok" />}
              <span className="flex-1 truncate font-medium">{x.name}</span>
              <span className="text-xs text-muted">{deviceName(x.deviceId)}</span>
              <span className="w-24 text-end text-xs tabular-nums text-muted">{formatBytes(x.size)}</span>
              <Badge tone={x.status === 'completed' ? 'ok' : x.status === 'active' ? 'accent' : x.status === 'paused' ? 'warn' : 'bad'}>{x.status}</Badge>
              <span className="w-36 text-end text-xs text-faint">{new Date(x.startedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
