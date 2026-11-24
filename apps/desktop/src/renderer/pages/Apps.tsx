import { useState } from 'react';
import { AppWindow, Globe, Plus, Sparkles, Trash2 } from 'lucide-react';
import { invoke } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction, useIpc } from '../lib/hooks';
import { Button, Card, Empty, ErrorNote, Field, inputClass } from '../components/ui';

interface AppRow {
  id: string;
  name: string;
  path: string;
  icon: string | null;
}
interface UrlRow {
  id: string;
  label: string;
  url: string;
}

export function Apps() {
  const { t } = useI18n();
  const apps = useIpc<AppRow[]>('apps.list');
  const urls = useIpc<UrlRow[]>('urls.list');
  const act = useAction();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('https://');

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.apps')}</h1>
          <p className="mt-1 text-sm text-muted">Only applications on this list can be launched from a phone. Phones can never run arbitrary programs or commands.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<Sparkles className="size-4" />} busy={act.busy} onClick={() => void act.run(() => invoke('apps.detect')).then(apps.reload)}>
            Detect installed
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => void act.run(() => invoke('apps.addDialog')).then(apps.reload)}>
            {t('apps.add')}
          </Button>
        </div>
      </header>
      <ErrorNote>{act.error || apps.error}</ErrorNote>

      <Card>
        {apps.data?.length === 0 && <Empty icon={<AppWindow className="size-10" />}>{t('common.none')}</Empty>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {apps.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-line bg-bg/40 p-3">
              {a.icon ? <img src={a.icon} alt="" className="size-9" /> : <AppWindow className="size-9 text-faint" />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="truncate text-xs text-faint" dir="ltr" title={a.path}>
                  {a.path}
                </div>
              </div>
              <button className="rounded-xl p-2 text-faint hover:bg-bad/15 hover:text-bad" onClick={() => void invoke('apps.remove', { id: a.id }).then(apps.reload)} aria-label="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t('apps.urls')}>
        <p className="mb-4 text-sm text-muted">Phones can open these websites (and their subdomains) in your default browser.</p>
        <div className="mb-4 grid grid-cols-[1fr_2fr_auto] items-end gap-3">
          <Field label="Name">
            <input className={inputClass} value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} placeholder="YouTube" />
          </Field>
          <Field label="URL">
            <input className={inputClass} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Button
            disabled={!label.trim() || url.length < 10}
            onClick={() =>
              void act.run(() => invoke('urls.add', { label: label.trim(), url: url.trim() })).then(() => {
                setLabel('');
                setUrl('https://');
                void urls.reload();
              })
            }
          >
            {t('common.add')}
          </Button>
        </div>
        <div className="divide-y divide-line">
          {urls.data?.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-2.5">
              <Globe className="size-4 text-accent" />
              <span className="font-medium">{u.label}</span>
              <span className="flex-1 truncate text-xs text-faint" dir="ltr">
                {u.url}
              </span>
              <button className="rounded-xl p-2 text-faint hover:text-bad" onClick={() => void invoke('urls.remove', { id: u.id }).then(urls.reload)} aria-label="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
