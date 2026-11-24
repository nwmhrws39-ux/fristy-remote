import { useMemo, useState } from 'react';
import { Eye, EyeOff, Gamepad2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { formatDuration } from '@fristy/shared/src/format';
import { invoke } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction, useIpc } from '../lib/hooks';
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, inputClass } from '../components/ui';

interface GameRow {
  id: string;
  name: string;
  source: string;
  launchKind: string;
  launchTarget: string;
  artworkUrl: string | null;
  hidden: boolean;
  favorite: boolean;
  playtimeSec: number;
  lastPlayed: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  ubisoft: 'Ubisoft Connect',
  rockstar: 'Rockstar',
  battlenet: 'Battle.net',
  ea: 'EA app',
  xbox: 'Xbox',
  fristy: 'FRISTY Launcher',
  manual: 'Manual'
};

export function Games() {
  const { t } = useI18n();
  const games = useIpc<GameRow[]>('games.list');
  const act = useAction();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => (games.data ?? []).filter((g) => g.name.toLowerCase().includes(q.toLowerCase())), [games.data, q]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.games')}</h1>
          <p className="mt-1 text-sm text-muted">Detected from Steam, Epic Games, Ubisoft Connect, Rockstar and Battle.net. Games launch through their official launcher, so DRM and sign-in keep working.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} busy={act.busy} onClick={() => void act.run(() => invoke('games.rescan')).then(games.reload)}>
            Rescan
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add game
          </Button>
        </div>
      </header>
      <ErrorNote>{act.error || games.error}</ErrorNote>
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input className={`${inputClass} ps-9`} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 && !games.loading && (
        <Card>
          <Empty icon={<Gamepad2 className="size-10" />}>{t('games.empty')}</Empty>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {list.map((g) => (
          <div key={g.id} className={`overflow-hidden rounded-3xl border border-line bg-card fade-in ${g.hidden ? 'opacity-40' : ''}`}>
            <div className="relative aspect-[460/215] bg-gradient-to-br from-accent/40 to-bg">
              {g.artworkUrl ? (
                <img src={g.artworkUrl} alt="" className="size-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              ) : (
                <div className="flex size-full items-center justify-center text-2xl font-black text-white/60">{g.name.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="absolute start-2 top-2">
                <Badge tone="neutral">{SOURCE_LABEL[g.source] ?? g.source}</Badge>
              </div>
            </div>
            <div className="p-3">
              <div className="truncate font-semibold" title={g.name}>
                {g.name}
              </div>
              <div className="mt-0.5 text-xs text-faint">
                {t('games.playtime')}: {formatDuration(g.playtimeSec)}
              </div>
              <div className="mt-2 flex justify-end gap-1">
                <button className="rounded-xl p-2 text-faint hover:text-fg" title={g.hidden ? 'Show on phone' : 'Hide from phone'} onClick={() => void invoke('games.hide', { id: g.id, hidden: !g.hidden }).then(games.reload)}>
                  {g.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <button className="rounded-xl p-2 text-faint hover:text-bad" title={t('common.delete')} onClick={() => void invoke('games.remove', { id: g.id }).then(games.reload)}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <AddGameDialog open={adding} onClose={() => setAdding(false)} onAdded={games.reload} />
    </div>
  );
}

function AddGameDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<'exe' | 'uri' | 'aumid'>('exe');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [artwork, setArtwork] = useState('');
  const [source, setSource] = useState<'manual' | 'ea' | 'rockstar'>('manual');
  const act = useAction();
  const done = () => {
    setName('');
    setTarget('');
    setArtwork('');
    onAdded();
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add game"
      footer={
        <Button
          busy={act.busy}
          disabled={mode !== 'exe' && (!name.trim() || !target.trim())}
          onClick={() =>
            void act
              .run(() =>
                mode === 'exe'
                  ? invoke('games.addExeDialog', { name: name.trim() || undefined, source })
                  : invoke('games.addManual', { name: name.trim(), kind: mode, target: target.trim(), source: mode === 'aumid' ? 'xbox' : 'manual', artworkUrl: artwork.trim() || null })
              )
              .then((r) => r !== undefined && r !== null && done())
          }
        >
          {mode === 'exe' ? 'Choose .exe…' : 'Add'}
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(
          [
            ['exe', 'Executable'],
            ['uri', 'Launcher URI'],
            ['aumid', 'Xbox / Store']
          ] as const
        ).map(([m, l]) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-2xl border px-3 py-2 text-sm ${mode === m ? 'border-accent bg-accent/15' : 'border-line text-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'exe' ? 'Optional – defaults to file name' : 'Game name'} />
        </Field>
        {mode === 'exe' && (
          <Field label="Store">
            <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              <option value="manual">Other / standalone</option>
              <option value="ea">EA app (the game hands off to EA app for sign-in)</option>
              <option value="rockstar">Rockstar Games Launcher</option>
            </select>
          </Field>
        )}
        {mode === 'uri' && (
          <Field label="Official launcher URI">
            <input className={inputClass} dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="steam://rungameid/620 · uplay://launch/635/0 · battlenet://WoW" />
          </Field>
        )}
        {mode === 'aumid' && (
          <Field label="AppUserModelID">
            <input className={inputClass} dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Microsoft.MinecraftUWP_8wekyb3d8bbwe!App" />
            <span className="mt-1 block text-xs text-faint">Find it with PowerShell: Get-StartApps</span>
          </Field>
        )}
        {mode !== 'exe' && (
          <Field label="Artwork URL (https, optional)">
            <input className={inputClass} dir="ltr" value={artwork} onChange={(e) => setArtwork(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorNote>{act.error}</ErrorNote>
    </Modal>
  );
}
