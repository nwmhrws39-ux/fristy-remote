import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-3xl border border-line bg-card p-5 fade-in', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-wide text-fg">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  variant = 'primary',
  busy,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: ReactNode }) {
  const styles: Record<Variant, string> = {
    primary: 'brand-gradient text-white hover:brightness-110 glow',
    ghost: 'border border-line bg-transparent text-fg hover:bg-elevated',
    subtle: 'bg-elevated text-fg hover:brightness-125',
    danger: 'bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25'
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-center justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
      </button>
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'accent' | 'neutral'; children: ReactNode }) {
  const t = {
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    accent: 'bg-accent/15 text-accent',
    neutral: 'bg-elevated text-muted'
  }[tone];
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', t)}>{children}</span>;
}

export function StatusDot({ online }: { online: boolean }) {
  return <span className={cx('inline-block size-2.5 rounded-full', online ? 'bg-ok pulse-dot' : 'bg-faint')} />;
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-3xl border border-line bg-elevated p-6 shadow-2xl outline-none fade-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-xl p-1.5 text-muted hover:bg-card" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-3 rounded-2xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{children}</p>;
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted">
      {icon && <div className="text-faint">{icon}</div>}
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-2xl border border-line bg-bg px-3 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent';

/** Animated area chart for live metrics (values 0..max; null = gap). */
export function Sparkline({ values, max = 100, height = 64, color = 'var(--fr-accent)' }: { values: (number | null)[]; max?: number; height?: number; color?: string }) {
  const w = 240;
  const id = useId().replace(/:/g, '');
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, v === null ? null : height - (Math.min(v, max) / max) * (height - 4) - 2] as const);
  const valid = pts.filter((p): p is readonly [number, number] => p[1] !== null);
  if (valid.length < 2) return <div style={{ height }} className="flex items-center justify-center text-xs text-faint">N/A</div>;
  const line = valid.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${valid[valid.length - 1]![0]},${height} L${valid[0]![0]},${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} style={{ transition: 'd .5s ease' }} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ transition: 'd .5s ease' }} />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="FRISTY">
      <defs>
        <linearGradient id="fristy-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B794FF" />
          <stop offset="1" stopColor="#6236E0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#fristy-logo)" />
      <path d="M22 16h24v8H31v6h12v8H31v10h-9z" fill="#fff" />
      <circle cx="46" cy="44" r="4" fill="#fff" opacity=".85" />
    </svg>
  );
}
