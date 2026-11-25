import { Activity, AppWindow, ClipboardList, FolderSync, Gamepad2, Monitor, MousePointer2, Power, Volume2, Zap } from 'lucide-react';
import { PERMISSIONS, type Permission } from '@fristy/protocol';
import type { StringKey } from '@fristy/shared/src/i18n';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

export const PERMISSION_ICONS: Record<Permission, typeof Power> = {
  monitor: Activity,
  power: Power,
  apps: AppWindow,
  games: Gamepad2,
  input: MousePointer2,
  audio: Volume2,
  files: FolderSync,
  macros: Zap,
  screen: Monitor,
  clipboard: ClipboardList
};

export const GRANTABLE: Permission[] = [...PERMISSIONS];

const SENSITIVE: Permission[] = ['power', 'input', 'files', 'screen', 'clipboard'];

export function PermissionPicker({ value, onChange }: { value: Permission[]; onChange: (v: Permission[]) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2">
      {GRANTABLE.map((p) => {
        const Icon = PERMISSION_ICONS[p];
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={cx(
              'flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-start text-sm transition',
              on ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-faint'
            )}
          >
            <Icon className={cx('size-4 shrink-0', on ? 'text-accent' : 'text-faint')} />
            <span className="flex-1">{t(`perm.${p}` as StringKey)}</span>
            {SENSITIVE.includes(p) && <span className="text-[10px] font-bold uppercase text-warn">!</span>}
          </button>
        );
      })}
    </div>
  );
}
