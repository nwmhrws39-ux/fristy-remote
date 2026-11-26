import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { errorText, invoke } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Card, ErrorNote, cx } from '../components/ui';

interface Stats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

const RANGES = [7, 30, 90] as const;

/** Daily active users (phones + PCs stacked), new users and app versions. */
export function AdminStats({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<Stats>('owner.stats', { days }).then(
      (s) => alive && (setData(s), setError(null)),
      (e) => alive && setError(errorText(e))
    );
    return () => {
      alive = false;
    };
  }, [days, refreshKey]);

  const max = Math.max(1, ...(data?.days.map((d) => d.users) ?? [1]));
  const shown = hover !== null ? data?.days[hover] : data?.days.at(-1);
  const vMax = Math.max(1, ...(data?.versions.map((v) => v.users) ?? [1]));

  return (
    <Card
      className="lg:col-span-2"
      title={
        <span className="flex items-center gap-2">
          <BarChart3 className="size-4" /> {t('owner.stats')}
        </span>
      }
      action={
        <span className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={cx('rounded-full px-3 py-0.5 text-xs font-semibold', days === r ? 'bg-accent text-white' : 'bg-elevated text-muted hover:text-fg')}
            >
              {r}d
            </button>
          ))}
        </span>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label={t('owner.total')} value={data.totals.users} />
            <Tile label={t('owner.phones')} value={data.totals.phones} dot="bg-accent" />
            <Tile label={t('owner.pcs')} value={data.totals.pcs} dot="bg-ok" />
            <Tile label={t('owner.active7')} value={data.totals.active7} />
            <Tile label={t('owner.active30')} value={data.totals.active30} />
          </div>

          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold">{t('owner.dailyUsers')}</span>
            {shown && (
              <span className="text-xs text-muted" dir="ltr">
                {shown.day} · <b className="text-fg">{shown.users}</b> ({shown.phones} 📱 · {shown.pcs} 💻) · +{shown.newUsers} {t('owner.newUsers')}
              </span>
            )}
          </div>
          <div className="relative mt-5 flex h-40 items-end gap-[3px]" dir="ltr" onMouseLeave={() => setHover(null)}>
            {[0.5, 1].map((f) => (
              <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${f * 100}%` }}>
                <span className="absolute -top-4 left-0 text-[10px] text-faint">{Math.round(max * f)}</span>
              </div>
            ))}
            {data.days.map((d, i) => (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
                <div className={cx('flex flex-col justify-end overflow-hidden rounded-t-[4px] transition-opacity', hover !== null && hover !== i && 'opacity-50')} style={{ height: `${(d.users / max) * 100}%` }}>
                  <div className="bg-accent" style={{ flexGrow: d.phones }} />
                  <div className="bg-ok" style={{ flexGrow: d.pcs }} />
                </div>
                {d.newUsers > 0 && <div className="mx-auto mt-0.5 size-1.5 rounded-full bg-warn" title={`+${d.newUsers}`} />}
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint" dir="ltr">
            <span>{data.days[0]?.day.slice(5)}</span>
            <span>{data.days.at(-1)?.day.slice(5)}</span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <Legend color="bg-accent" label={t('owner.phones')} />
            <Legend color="bg-ok" label={t('owner.pcs')} />
            <Legend color="bg-warn" label={t('owner.newUsers')} round />
          </div>

          <div className="mt-6 mb-2 text-sm font-semibold">{t('owner.versions')}</div>
          {data.versions.length === 0 && <div className="text-sm text-faint">—</div>}
          <div className="space-y-1.5">
            {data.versions.map((v) => (
              <div key={`${v.version}-${v.kind}`} className="flex items-center gap-3 text-sm" dir="ltr">
                <span className="w-24 shrink-0 font-mono text-xs">
                  {v.kind === 'pc' ? '💻' : '📱'} v{v.version}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-elevated">
                  <div className={cx('h-full rounded-full', v.kind === 'pc' ? 'bg-ok' : 'bg-accent')} style={{ width: `${(v.users / vMax) * 100}%` }} />
                </div>
                <span className="w-8 text-end text-xs text-muted">{v.users}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Tile({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <div className="rounded-xl bg-elevated px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {dot && <span className={cx('size-2 rounded-full', dot)} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Legend({ color, label, round }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx(round ? 'size-2 rounded-full' : 'h-2 w-3 rounded-sm', color)} />
      {label}
    </span>
  );
}
