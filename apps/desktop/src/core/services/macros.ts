import { MacroStepSchema, type MacroEntry, type MacroStep, type Permission } from '@fristy/protocol';
import { randomId } from '@fristy/shared';
import { z } from 'zod';
import type { MacroRow, Store } from '../db';

export const MacroInputSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(48),
  icon: z.string().max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  steps: z.array(MacroStepSchema).min(1).max(20)
});

/** Permission each macro step needs. A macro only runs if the device holds all of them. */
export function stepPermission(step: MacroStep): Permission | null {
  switch (step.type) {
    case 'launchApp':
    case 'openUrl':
      return 'apps';
    case 'launchGame':
      return 'games';
    case 'setVolume':
    case 'mute':
    case 'media':
      return 'audio';
    case 'power':
      return 'power';
    case 'wait':
      return null;
  }
}

export interface MacroExecutor {
  launchApp(id: string): Promise<unknown>;
  launchGame(id: string): Promise<unknown>;
  openUrl(url: string): Promise<unknown>;
  setVolume(level: number): Promise<unknown>;
  mute(muted: boolean): Promise<unknown>;
  media(action: 'playPause' | 'next' | 'previous' | 'stop'): Promise<unknown>;
  power(action: 'lock' | 'monitorOff' | 'sleep'): Promise<unknown>;
}

export const DEFAULT_MACROS: Omit<MacroRow, 'id'>[] = [
  { name: 'Gaming Mode', icon: 'gamepad-2', color: '#9B6BFF', steps: [{ type: 'launchApp', appId: 'discord' }, { type: 'launchApp', appId: 'steam' }] },
  { name: 'Work Mode', icon: 'briefcase', color: '#5B8CFF', steps: [{ type: 'launchApp', appId: 'vscode' }, { type: 'launchApp', appId: 'chrome' }] },
  { name: 'Music Mode', icon: 'music', color: '#3EDC8F', steps: [{ type: 'launchApp', appId: 'spotify' }] },
  { name: 'Streaming Mode', icon: 'radio', color: '#FF5470', steps: [{ type: 'launchApp', appId: 'obs' }] },
  {
    name: 'Night Mode',
    icon: 'moon',
    color: '#FFB547',
    steps: [{ type: 'setVolume', level: 15 }, { type: 'wait', ms: 500 }, { type: 'power', action: 'lock' }]
  }
];

export class MacroService {
  constructor(private readonly store: Store) {}

  list(): MacroEntry[] {
    return this.store.listMacros();
  }

  seedDefaults() {
    if (this.store.getSetting('macrosSeeded', false)) return;
    for (const m of DEFAULT_MACROS) this.store.upsertMacro({ ...m, id: randomId(6) });
    this.store.setSetting('macrosSeeded', true);
  }

  save(input: z.input<typeof MacroInputSchema>): MacroRow {
    const m = MacroInputSchema.parse(input);
    const row: MacroRow = { id: m.id ?? randomId(6), name: m.name, icon: m.icon, color: m.color, steps: m.steps };
    this.store.upsertMacro(row);
    return row;
  }

  remove(id: string) {
    this.store.removeMacro(id);
  }

  missingPermissions(macro: MacroRow, grants: readonly Permission[]): Permission[] {
    const needed = new Set(macro.steps.map(stepPermission).filter((p): p is Permission => p !== null));
    return [...needed].filter((p) => !grants.includes(p));
  }

  async run(macroId: string, grants: readonly Permission[], exec: MacroExecutor): Promise<{ steps: number }> {
    const macro = this.store.listMacros().find((m) => m.id === macroId);
    if (!macro) throw Object.assign(new Error('macro not found'), { code: 'not_found' });
    const missing = this.missingPermissions(macro, grants);
    if (missing.length) {
      throw Object.assign(new Error(`macro needs permissions: ${missing.join(', ')}`), { code: 'forbidden' });
    }
    let n = 0;
    for (const step of macro.steps) {
      switch (step.type) {
        case 'launchApp':
          await exec.launchApp(step.appId);
          break;
        case 'launchGame':
          await exec.launchGame(step.gameId);
          break;
        case 'openUrl':
          await exec.openUrl(step.url);
          break;
        case 'setVolume':
          await exec.setVolume(step.level);
          break;
        case 'mute':
          await exec.mute(step.muted);
          break;
        case 'media':
          await exec.media(step.action);
          break;
        case 'power':
          await exec.power(step.action);
          break;
        case 'wait':
          await new Promise((r) => setTimeout(r, step.ms));
          break;
      }
      n++;
    }
    return { steps: n };
  }
}
