import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { StringKey } from '@fristy/shared/src/i18n';
import { addressKind } from '@fristy/shared/src/wol';
import { useI18n } from '../lib/i18n';
import { useIpc } from '../lib/hooks';
import { Badge, Button, Card, Empty, cx } from '../components/ui';

interface LogRow {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'security';
  category: string;
  message: string;
  remote: string | null;
}

const CATEGORIES = ['', 'auth', 'pairing', 'connection', 'devices', 'permission', 'action', 'input', 'files', 'network'];

export function Logs() {
  const { t } = useI18n();
  const [category, setCategory] = useState('');
  const [showIps, setShowIps] = useState(false);
  const logs = useIpc<LogRow[]>('logs.list', category ? { category } : {}, [category]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.logs')}</h1>
          <p className="mt-1 text-sm text-muted">Stored only on this PC. Typed text and keystrokes are never logged.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowIps((v) => !v)}>
            {showIps ? t('common.hideDetails') : t('common.showDetails')}
          </Button>
          <Button variant="ghost" onClick={() => void logs.reload()}>
            ↻
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c || 'all'} onClick={() => setCategory(c)} className={cx('rounded-full px-3 py-1 text-xs font-semibold', category === c ? 'bg-accent text-white' : 'bg-card text-muted')}>
            {c || t('common.all')}
          </button>
        ))}
      </div>
      <Card>
        {logs.data?.length === 0 && <Empty icon={<ShieldAlert className="size-10" />}>{t('common.none')}</Empty>}
        <div className="divide-y divide-line font-mono text-xs">
          {logs.data?.map((l) => (
            <div key={l.id} className="flex items-start gap-3 py-2">
              <span className="w-44 shrink-0 whitespace-nowrap text-faint">{new Date(l.ts).toLocaleString()}</span>
              <Badge tone={l.level === 'security' ? 'bad' : l.level === 'warn' ? 'warn' : 'neutral'}>{l.category}</Badge>
              <span className="flex-1 text-fg" dir="auto">
                {l.message}
              </span>
              {l.remote && (
                <span className="text-faint" dir="ltr">
                  {showIps ? l.remote : t(`route.${addressKind(l.remote)}` as StringKey)}
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
