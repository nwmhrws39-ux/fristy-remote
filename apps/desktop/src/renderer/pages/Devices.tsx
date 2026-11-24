import { useState } from 'react';
import { Pencil, Smartphone, Unplug } from 'lucide-react';
import type { Permission } from '@fristy/protocol';
import { invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Badge, Button, Card, Empty, Modal, StatusDot, inputClass } from '../components/ui';
import { PermissionPicker } from '../components/permissions';

type Device = CoreState['devices'][number];

export function Devices({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [rename, setRename] = useState<{ d: Device; name: string } | null>(null);
  const online = new Set(state.sessions.map((s) => s.deviceId));

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('devices.title')}</h1>
        <Button variant="ghost" icon={<Unplug className="size-4" />} disabled={!state.sessions.length} onClick={() => void invoke('devices.disconnectAll')}>
          {t('devices.disconnectAll')}
        </Button>
      </header>
      {state.devices.length === 0 && (
        <Card>
          <Empty icon={<Smartphone className="size-10" />}>{t('devices.none')}</Empty>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {state.devices.map((d) => (
          <Card
            key={d.id}
            title={
              <span className="flex items-center gap-2">
                <StatusDot online={online.has(d.id)} />
                {d.name}
                <button className="text-faint hover:text-fg" onClick={() => setRename({ d, name: d.name })} aria-label="Rename">
                  <Pencil className="size-3.5" />
                </button>
              </span>
            }
            action={<Badge tone={online.has(d.id) ? 'ok' : 'neutral'}>{online.has(d.id) ? t('devices.connected') : t('common.offline')}</Badge>}
          >
            <div className="mb-4 text-xs text-muted">
              {d.platform} · {t('devices.lastSeen')}: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
            </div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('devices.permissions')}</div>
            <PermissionPicker value={d.permissions} onChange={(p: Permission[]) => void invoke('devices.permissions', { id: d.id, permissions: p })} />
            <div className="mt-5 flex justify-end">
              <Button variant="danger" onClick={() => setRevoke(d)}>
                {t('devices.revoke')}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title={t('devices.revoke')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoke(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void invoke('devices.revoke', { id: revoke!.id });
                setRevoke(null);
              }}
            >
              {t('devices.revoke')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{revoke && t('devices.confirmRevoke', { name: revoke.name })}</p>
      </Modal>

      <Modal
        open={!!rename}
        onClose={() => setRename(null)}
        title={t('common.save')}
        footer={
          <Button
            disabled={!rename?.name.trim()}
            onClick={() => {
              void invoke('devices.rename', { id: rename!.d.id, name: rename!.name.trim() });
              setRename(null);
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <input className={inputClass} value={rename?.name ?? ''} maxLength={64} onChange={(e) => setRename((r) => r && { ...r, name: e.target.value })} />
      </Modal>
    </div>
  );
}
