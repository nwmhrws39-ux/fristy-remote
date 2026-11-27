import { useState } from 'react';
import { AlertTriangle, Download, FileText, Flag, History, KeyRound, Lock, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { LEGAL_DOCS, REPORT_CATEGORIES, type ReportCategory } from '@fristy/shared/src/legal';
import type { StringKey } from '@fristy/shared/src/i18n';
import { errorText, invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { DocLink } from '../components/LegalGate';
import { Badge, Button, Card, ErrorNote, Field, Toggle, cx, inputClass } from '../components/ui';

const RETENTION = [7, 30, 90, 180, 365];

/** Privacy & Security center: who has access, what is stored, and the user's controls. */
export function Privacy({ state }: { state: CoreState }) {
  const { t, lang } = useI18n();
  const s = state.settings;
  const [note, setNote] = useState<string | null>(null);
  const act = useAction();
  const devices = state.devices.filter((d) => !d.revokedAt);
  const connected = new Set(state.sessions.map((x) => x.deviceId));
  const accepted = state.legal.accepted;
  const when = (ts: number) => new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : undefined);
  const saved = (p: string | null) => p && setNote(t('privacy.saved', { path: p }));
  const set = (patch: Record<string, unknown>) => void invoke('settings.update', patch);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <ShieldCheck className="size-7 text-accent" /> {t('privacy.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('privacy.sub')}</p>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
        <span>{t('privacy.emergencyHint')}</span>
      </div>
      {note && <div className="rounded-2xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{note}</div>}
      <ErrorNote>{act.error}</ErrorNote>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Smartphone className="size-4" /> {t('privacy.access')}</span>}>
          {devices.length === 0 && <p className="text-sm text-faint">{t('privacy.noDevices')}</p>}
          <div className="divide-y divide-line">
            {devices.map((d) => (
              <div key={d.id} className="py-2.5 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  {d.name}
                  {connected.has(d.id) && <Badge tone="ok">{t('privacy.activeNow')}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.permissions.map((p) => (
                    <span key={p} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                      {t(`perm.${p}` as StringKey)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button
            className="mt-4"
            variant="danger"
            icon={<KeyRound className="size-4" />}
            disabled={devices.length === 0}
            onClick={() => confirm(t('privacy.revokeAllConfirm')) && void act.run(() => invoke('privacy.revokeAll'))}
          >
            {t('privacy.revokeAll')}
          </Button>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Lock className="size-4" /> {t('privacy.features')}</span>}>
          <div className="space-y-3">
            <Toggle checked={s.remoteEnabled} onChange={(v) => set({ remoteEnabled: v })} label={t('settings.remoteAccess')} />
            <Toggle checked={s.relayEnabled} onChange={(v) => set({ relayEnabled: v })} label={t('legal.optRelay')} />
            <Toggle checked={s.screenEnabled} onChange={(v) => set({ screenEnabled: v })} label={t('legal.optScreen')} />
            <Toggle checked={s.inputEnabled} onChange={(v) => set({ inputEnabled: v })} label={t('legal.optInput')} />
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><History className="size-4" /> {t('privacy.history')}</span>}>
          <p className="text-sm text-muted">{t('privacy.historyHint')}</p>
          <div className="mt-4 flex items-end gap-3">
            <Field label={t('privacy.retention')}>
              <select className={inputClass} value={s.historyRetentionDays} onChange={(e) => set({ historyRetentionDays: Number(e.target.value) })}>
                {RETENTION.map((d) => (
                  <option key={d} value={d}>
                    {t('privacy.days', { n: d })}
                  </option>
                ))}
              </select>
            </Field>
            <Button className="mb-0.5" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void act.run(() => invoke('privacy.deleteHistory')).then(() => setNote(t('privacy.deleted')))}>
              {t('privacy.deleteHistory')}
            </Button>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Download className="size-4" /> {t('privacy.yourData')}</span>}>
          <div className="flex flex-col items-start gap-2">
            <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => void act.run(() => invoke<string | null>('privacy.export')).then((p) => saved(p ?? null))}>
              {t('privacy.exportLocal')}
            </Button>
            {state.owner.enabled && (
              <>
                <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => void act.run(() => invoke<string | null>('privacy.remoteExport')).then((p) => saved(p ?? null))}>
                  {t('privacy.exportRemote')}
                </Button>
                <Button
                  variant="danger"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => confirm(t('privacy.deleteRemoteConfirm')) && void act.run(() => invoke('privacy.remoteDelete')).then((r) => r && setNote(t('privacy.deleted')))}
                >
                  {t('privacy.deleteRemote')}
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><FileText className="size-4" /> {t('privacy.legal')}</span>}>
          {accepted && <p className="mb-3 text-sm text-muted">{t('legal.acceptedOn', { v: accepted.version, date: when(accepted.acceptedAt) })}</p>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {LEGAL_DOCS.map((d) => (
              <DocLink key={d.id} id={d.id} />
            ))}
          </div>
          <Button className="mt-5" variant="ghost" onClick={() => confirm(t('privacy.withdrawConfirm')) && void act.run(() => invoke('privacy.withdraw'))}>
            {t('privacy.withdraw')}
          </Button>
        </Card>

        {state.owner.enabled && <ReportCard />}
      </div>
    </div>
  );
}

function ReportCard() {
  const { t } = useI18n();
  const [category, setCategory] = useState<ReportCategory>('unauthorized-access');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title={<span className="flex items-center gap-2"><Flag className="size-4" /> {t('privacy.report')}</span>}>
      <p className="text-sm text-muted">{t('privacy.reportHint')}</p>
      {done ? (
        <p className="mt-4 rounded-xl bg-ok/10 p-3 text-sm text-ok">{t('privacy.sent')}</p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void invoke('privacy.report', { category, message: message.trim(), ...(contact.trim() ? { contact: contact.trim() } : {}) })
              .then(() => setDone(true), (err) => setError(errorText(err)))
              .finally(() => setBusy(false));
          }}
        >
          <Field label={t('privacy.category')}>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)}>
              {REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`privacy.cat.${c}` as StringKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('privacy.message')}>
            <textarea className={cx(inputClass, 'h-24 py-2')} value={message} maxLength={1000} dir="auto" onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label={t('privacy.contact')}>
            <input className={inputClass} value={contact} maxLength={200} dir="auto" onChange={(e) => setContact(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button busy={busy} disabled={message.trim().length < 5}>
            {t('privacy.send')}
          </Button>
        </form>
      )}
    </Card>
  );
}
