import { useState } from 'react';
import { Briefcase, Code, Coffee, Film, Gamepad2, Monitor, Moon, Music, Plus, Radio, Trash2, Zap } from 'lucide-react';
import type { MacroEntry, MacroStep } from '@fristy/protocol';
import { MACRO_COLORS, MACRO_ICONS } from '@fristy/ui';
import { invoke } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction, useIpc } from '../lib/hooks';
import { Button, Card, Empty, ErrorNote, Field, Modal, inputClass } from '../components/ui';

export const MACRO_ICON_COMPONENTS: Record<string, typeof Zap> = {
  'gamepad-2': Gamepad2,
  briefcase: Briefcase,
  music: Music,
  radio: Radio,
  moon: Moon,
  zap: Zap,
  monitor: Monitor,
  coffee: Coffee,
  film: Film,
  code: Code
};

function describe(step: MacroStep, apps: { id: string; name: string }[], games: { id: string; name: string }[]): string {
  switch (step.type) {
    case 'launchApp':
      return `Launch ${apps.find((a) => a.id === step.appId)?.name ?? `app "${step.appId}" (not installed)`}`;
    case 'launchGame':
      return `Launch ${games.find((g) => g.id === step.gameId)?.name ?? 'game'}`;
    case 'openUrl':
      return `Open ${step.url}`;
    case 'setVolume':
      return `Set volume to ${step.level}%`;
    case 'mute':
      return step.muted ? 'Mute audio' : 'Unmute audio';
    case 'media':
      return `Media: ${step.action}`;
    case 'power':
      return { lock: 'Lock computer', monitorOff: 'Turn off monitor', monitorOn: 'Turn on monitor', sleep: 'Sleep' }[step.action];
    case 'wait':
      return `Wait ${step.ms} ms`;
  }
}

export function Macros() {
  const { t } = useI18n();
  const macros = useIpc<MacroEntry[]>('macros.list');
  const apps = useIpc<{ id: string; name: string }[]>('apps.list');
  const games = useIpc<{ id: string; name: string }[]>('games.list');
  const [edit, setEdit] = useState<MacroEntry | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('nav.macros')}</h1>
          <p className="mt-1 text-sm text-muted">Macros combine approved actions only. A phone needs every permission a macro uses to run it.</p>
        </div>
        <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ id: '', name: '', icon: 'zap', color: MACRO_COLORS[0], steps: [] })}>
          {t('common.add')}
        </Button>
      </header>
      {macros.data?.length === 0 && (
        <Card>
          <Empty icon={<Zap className="size-10" />}>{t('macros.empty')}</Empty>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {macros.data?.map((m) => {
          const Icon = MACRO_ICON_COMPONENTS[m.icon] ?? Zap;
          return (
            <button key={m.id} onClick={() => setEdit(m)} className="rounded-3xl border border-line bg-card p-5 text-start transition hover:border-accent fade-in">
              <div className="mb-3 flex items-center gap-3">
                <div className="rounded-2xl p-2.5" style={{ background: m.color + '26', color: m.color }}>
                  <Icon className="size-5" />
                </div>
                <div className="font-semibold">{m.name}</div>
              </div>
              <ol className="space-y-1 text-xs text-muted">
                {m.steps.map((s, i) => (
                  <li key={i}>
                    {i + 1}. {describe(s, apps.data ?? [], games.data ?? [])}
                  </li>
                ))}
              </ol>
            </button>
          );
        })}
      </div>
      {edit && <MacroEditor macro={edit} apps={apps.data ?? []} games={games.data ?? []} onClose={() => setEdit(null)} onSaved={macros.reload} />}
    </div>
  );
}

const STEP_TYPES: { type: MacroStep['type']; label: string; make: () => MacroStep }[] = [
  { type: 'launchApp', label: 'Launch app', make: () => ({ type: 'launchApp', appId: '' }) },
  { type: 'launchGame', label: 'Launch game', make: () => ({ type: 'launchGame', gameId: '' }) },
  { type: 'openUrl', label: 'Open website', make: () => ({ type: 'openUrl', url: 'https://' }) },
  { type: 'setVolume', label: 'Set volume', make: () => ({ type: 'setVolume', level: 30 }) },
  { type: 'mute', label: 'Mute / unmute', make: () => ({ type: 'mute', muted: true }) },
  { type: 'media', label: 'Media key', make: () => ({ type: 'media', action: 'playPause' }) },
  { type: 'power', label: 'Lock / monitor / sleep', make: () => ({ type: 'power', action: 'lock' }) },
  { type: 'wait', label: 'Wait', make: () => ({ type: 'wait', ms: 1000 }) }
];

function MacroEditor({ macro, apps, games, onClose, onSaved }: { macro: MacroEntry; apps: { id: string; name: string }[]; games: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [m, setM] = useState<MacroEntry>(macro);
  const act = useAction();
  const setStep = (i: number, s: MacroStep) => setM({ ...m, steps: m.steps.map((x, j) => (j === i ? s : x)) });

  return (
    <Modal
      open
      onClose={onClose}
      title={macro.id ? macro.name : t('common.add')}
      footer={
        <>
          {macro.id && (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void invoke('macros.remove', { id: macro.id }).then(() => (onSaved(), onClose()))}>
              {t('common.delete')}
            </Button>
          )}
          <Button
            busy={act.busy}
            disabled={!m.name.trim() || m.steps.length === 0}
            onClick={() =>
              void act
                .run(() => invoke('macros.save', { ...(m.id ? { id: m.id } : {}), name: m.name.trim(), icon: m.icon, color: m.color, steps: m.steps }))
                .then((r) => r && (onSaved(), onClose()))
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1">
        <Field label="Name">
          <input className={inputClass} value={m.name} maxLength={48} onChange={(e) => setM({ ...m, name: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {MACRO_ICONS.map((ic) => {
            const Icon = MACRO_ICON_COMPONENTS[ic]!;
            return (
              <button key={ic} onClick={() => setM({ ...m, icon: ic })} className={`rounded-xl border p-2 ${m.icon === ic ? 'border-accent text-accent' : 'border-line text-muted'}`}>
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          {MACRO_COLORS.map((c) => (
            <button key={c} aria-label={c} onClick={() => setM({ ...m, color: c })} className={`size-7 rounded-full border-2 ${m.color === c ? 'border-fg' : 'border-transparent'}`} style={{ background: c }} />
          ))}
        </div>
        <div className="space-y-2">
          {m.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-2xl border border-line p-2">
              <span className="w-5 text-center text-xs text-faint">{i + 1}</span>
              <StepFields step={s} apps={apps} games={games} onChange={(x) => setStep(i, x)} />
              <button className="p-1.5 text-faint hover:text-bad" onClick={() => setM({ ...m, steps: m.steps.filter((_, j) => j !== i) })} aria-label="Remove step">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <select
          className={inputClass}
          value=""
          onChange={(e) => {
            const def = STEP_TYPES.find((d) => d.type === e.target.value);
            if (def && m.steps.length < 20) setM({ ...m, steps: [...m.steps, def.make()] });
          }}
        >
          <option value="">+ Add step…</option>
          {STEP_TYPES.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </select>
        <ErrorNote>{act.error}</ErrorNote>
      </div>
    </Modal>
  );
}

function StepFields({ step, apps, games, onChange }: { step: MacroStep; apps: { id: string; name: string }[]; games: { id: string; name: string }[]; onChange: (s: MacroStep) => void }) {
  const cls = `${inputClass} h-9`;
  switch (step.type) {
    case 'launchApp':
      return (
        <select className={cls} value={step.appId} onChange={(e) => onChange({ ...step, appId: e.target.value })}>
          <option value="">Choose app…</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      );
    case 'launchGame':
      return (
        <select className={cls} value={step.gameId} onChange={(e) => onChange({ ...step, gameId: e.target.value })}>
          <option value="">Choose game…</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      );
    case 'openUrl':
      return <input className={cls} dir="ltr" value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} />;
    case 'setVolume':
      return (
        <div className="flex flex-1 items-center gap-2">
          <input type="range" min={0} max={100} value={step.level} onChange={(e) => onChange({ ...step, level: Number(e.target.value) })} className="flex-1 accent-[var(--fr-accent)]" />
          <span className="w-10 text-xs">{step.level}%</span>
        </div>
      );
    case 'mute':
      return (
        <select className={cls} value={String(step.muted)} onChange={(e) => onChange({ ...step, muted: e.target.value === 'true' })}>
          <option value="true">Mute</option>
          <option value="false">Unmute</option>
        </select>
      );
    case 'media':
      return (
        <select className={cls} value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value as typeof step.action })}>
          <option value="playPause">Play / pause</option>
          <option value="next">Next track</option>
          <option value="previous">Previous track</option>
          <option value="stop">Stop</option>
        </select>
      );
    case 'power':
      return (
        <select className={cls} value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value as typeof step.action })}>
          <option value="lock">Lock computer</option>
          <option value="monitorOff">Turn off monitor</option>
          <option value="monitorOn">Turn on monitor</option>
          <option value="sleep">Sleep</option>
        </select>
      );
    case 'wait':
      return <input type="number" className={cls} min={0} max={30000} step={100} value={step.ms} onChange={(e) => onChange({ ...step, ms: Math.min(30000, Math.max(0, Number(e.target.value))) })} />;
  }
}
