import { useState } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { LEGAL_CONTRACT_DOCS, LEGAL_DOCS, LEGAL_NOTICE_DOCS, type LegalDocId } from '@fristy/shared/src/legal';
import { invoke, type CoreState } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { Button, ErrorNote, Logo } from './ui';

export function DocLink({ id }: { id: LegalDocId }) {
  const { lang } = useI18n();
  const d = LEGAL_DOCS.find((x) => x.id === id)!;
  return (
    <button type="button" onClick={() => void invoke('legal.open', { page: id })} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
      {lang === 'he' ? d.he : d.en}
      <ExternalLink className="size-3" />
    </button>
  );
}

/**
 * Mandatory legal onboarding: shown before the app can be used and again when
 * the document version changes. Nothing is pre-selected; the contract and the
 * optional features are separate choices, and declining quits the app.
 */
export function LegalGate({ state }: { state: CoreState }) {
  const { t } = useI18n();
  const [accepted, setAccepted] = useState(false);
  const [opt, setOpt] = useState({ relay: false, screen: false, input: false });
  const act = useAction();
  const previous = state.legal.accepted;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-bg/95 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <div className="w-full max-w-2xl rounded-3xl border border-line bg-elevated p-8 shadow-2xl fade-in">
        <div className="mb-6 flex items-center gap-4">
          <Logo size={44} />
          <div>
            <h1 id="legal-title" className="text-2xl font-bold">
              {t('legal.title')}
            </h1>
            {previous && previous.version !== state.legal.current && <p className="text-sm text-warn">{t('legal.updated', { v: state.legal.current })}</p>}
          </div>
        </div>

        <p className="text-sm text-muted">{t('legal.intro')}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {[...LEGAL_CONTRACT_DOCS, ...LEGAL_NOTICE_DOCS].map((id) => (
            <DocLink key={id} id={id} />
          ))}
        </div>

        <div className="mt-5 flex gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <p>{t('legal.privacyNotice')}</p>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-4 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--fr-accent)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>{t('legal.acceptBox')}</span>
        </label>

        <fieldset className="mt-5 rounded-2xl border border-line p-4 text-sm">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('legal.optionalTitle')}</legend>
          {(['relay', 'screen', 'input'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-start gap-3 py-1.5">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--fr-accent)]" checked={opt[k]} onChange={(e) => setOpt((o) => ({ ...o, [k]: e.target.checked }))} />
              <span>{t(k === 'relay' ? 'legal.optRelay' : k === 'screen' ? 'legal.optScreen' : 'legal.optInput')}</span>
            </label>
          ))}
        </fieldset>

        <ErrorNote>{act.error}</ErrorNote>
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-faint">{t('legal.draft')}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void invoke('legal.decline')}>
              {t('legal.decline')}
            </Button>
            <Button busy={act.busy} disabled={!accepted} onClick={() => void act.run(() => invoke('legal.accept', { adult: true, accepted: true, optional: opt }))}>
              {t('legal.continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
