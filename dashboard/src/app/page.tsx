'use client';

import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Ticket, TicketRow, TicketSkeleton, type Order } from '@/components/Ticket';
import { ToastHost, useToast } from '@/components/Toast';
import { rupees, elapsed, toneOf, TONE_VAR } from '@/lib/heat';
import { chime, setChimeEnabled, chimeEnabled } from '@/lib/chime';
import { ThemeToggle } from '@/components/ThemeToggle';

const fetcher = async (u: string) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  return r.json();
};

const COLUMNS = [
  { key: 'new', label: 'New', ur: 'نیا', empty: 'Nothing waiting. The bot is listening.' },
  { key: 'preparing', label: 'Cooking', ur: 'پک رہا ہے', empty: 'Nothing in the tandoor.' },
  { key: 'on_the_way', label: 'Out', ur: 'راستے میں', empty: 'No riders out.' },
] as const;

/** Past this many tickets a column stops being scannable as cards. */
const AUTO_COMPACT_AT = 8;
/** Hard render cap per column. Beyond this we count rather than paint. */
const RENDER_CAP = 40;

export default function Page() {
  return (
    <ToastHost>
      <Board />
    </ToastHost>
  );
}

function Board() {
  const { push } = useToast();

  // The board only ever asks for OPEN orders, so this payload stays flat
  // whether the shop does 40 covers today or 4000.
  const { data, error, mutate, isLoading } = useSWR('/api/orders', fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
  });
  const { data: stats } = useSWR('/api/stats', fetcher, { refreshInterval: 20000 });

  const [pending, setPending] = useState<Record<number, string>>({});
  const [sound, setSound] = useState(true);
  const [density, setDensity] = useState<'auto' | 'card' | 'row'>('auto');

  const orders: Order[] = data?.orders ?? [];
  const promise: number = data?.promiseMinutes ?? 45;

  useEffect(() => setChimeEnabled(sound), [sound]);
  useEffect(() => setSound(chimeEnabled()), []);

  const seen = useRef<Set<number> | null>(null);
  const [arrivals, setArrivals] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!data) return;
    const ids = orders.map((o) => o.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    if (fresh.length) {
      setArrivals(new Set(fresh));
      chime();
      push(fresh.length === 1 ? `Order #${fresh[0]} came in.` : `${fresh.length} new orders.`, 'ok');
      setTimeout(() => setArrivals(new Set()), 4000);
    }
    ids.forEach((id) => seen.current!.add(id));
  }, [data]);

  const move = useCallback(
    async (order: Order, to: string) => {
      const from = order.status;
      setPending((p) => ({ ...p, [order.id]: to }));

      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
      const body = await res.json().catch(() => ({}));

      setPending((p) => {
        const { [order.id]: _gone, ...rest } = p;
        return rest;
      });
      await mutate();

      if (!res.ok) return push(body?.error ?? 'That did not go through.', 'error');

      const undo = async () => {
        const r = await fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: from, revert: true }),
        });
        const b = await r.json().catch(() => ({}));
        await mutate();
        push(r.ok ? `Order #${order.id} moved back.` : (b?.error ?? 'Too late to undo.'), r.ok ? 'ok' : 'error');
      };

      const what =
        to === 'cancelled' ? 'cancelled'
        : to === 'preparing' ? 'is cooking'
        : to === 'on_the_way' ? 'is with the rider'
        : 'delivered';

      push(`Order #${order.id} ${what}. Telling the customer.`, 'ok', undo);
    },
    [mutate, push],
  );

  const byStatus = useMemo(() => {
    const m: Record<string, Order[]> = { new: [], preparing: [], on_the_way: [] };
    for (const o of orders) (m[pending[o.id] ?? o.status] ??= []).push(o);
    return m;
  }, [orders, pending]);

  const late = orders.filter((o) => o.age_seconds > promise * 60).length;
  const oldest = orders.reduce<Order | null>(
    (a, o) => (!a || o.age_seconds > a.age_seconds ? o : a), null);
  const busiest = Math.max(...COLUMNS.map((c) => byStatus[c.key]?.length ?? 0), 0);
  const compact = density === 'row' || (density === 'auto' && busiest >= AUTO_COMPACT_AT);

  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      {/* ------------------------------------------------------------ chrome */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3">
        <h1 className="font-display text-[17px] font-bold tracking-tight text-fg">Tandoor Pass</h1>

        <span className="flex items-center gap-2 text-[13px] text-sub">
          <span
            className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${
              error ? 'bg-s-over' : 'bg-s-fresh'
            }`}
          />
          {error ? 'Reconnecting' : `${orders.length} open`}
        </span>

        {/* The one number a kitchen is actually judged on. */}
        <span className="flex items-baseline gap-2 border-l border-line pl-5">
          <span className="eyebrow">Oldest</span>
          <span
            className="tnum font-mono text-[22px] font-bold leading-none"
            style={{ color: oldest ? TONE_VAR[toneOf(oldest.age_seconds, promise)] : undefined }}
          >
            {oldest ? elapsed(oldest.age_seconds) : '—'}
          </span>
          {oldest && <span className="font-mono text-[12px] text-mute">#{oldest.id}</span>}
        </span>

        {late > 0 && (
          <span className="rounded-full bg-s-over/12 px-2.5 py-1 text-[12px] font-semibold text-s-over">
            {late} past promise
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          <Stat label="Today" value={stats?.orders ?? '—'} />
          <Stat
            label="Taken"
            value={stats ? `Rs ${rupees(Number(stats.revenue))}` : '—'}
            className="max-lg:hidden"
          />

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setDensity(compact ? 'card' : 'row')}
              className="btn btn-ghost !min-h-[30px] !px-2.5 !text-[12px]"
              title={compact ? 'Switch to cards' : 'Switch to compact rows'}
            >
              {compact ? 'Cards' : 'Compact'}
            </button>
            <button
              onClick={() => setSound((v) => !v)}
              className="btn btn-ghost !min-h-[30px] !px-2.5"
              title={sound ? 'Sound on for new orders' : 'Sound off'}
              aria-pressed={sound}
            >
              {sound ? '🔔' : '🔕'}
            </button>
            <ThemeToggle />
            <Link href="/history" className="btn btn-ghost !min-h-[30px]">History</Link>
            <Link href="/menu" className="btn btn-ghost !min-h-[30px]">Menu</Link>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------- board */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-y-auto bg-line md:auto-rows-[minmax(0,1fr)] md:grid-cols-3 md:overflow-hidden">
        {COLUMNS.map((col) => {
          const list = byStatus[col.key] ?? [];
          const shown = list.slice(0, RENDER_CAP);
          const hidden = list.length - shown.length;

          return (
            <section key={col.key} className="flex min-h-0 flex-col bg-ink-900">
              <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
                <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.14em] text-sub">
                  {col.label}
                </h2>
                <span className="urdu" lang="ur" dir="rtl">{col.ur}</span>
                <span className="tnum ml-auto rounded-full bg-ink-800 px-2 py-0.5 font-mono text-[11.5px] text-sub">
                  {list.length}
                </span>
              </div>

              <div className={`scroller min-h-0 flex-1 px-3 py-3 ${compact ? 'space-y-0.5' : 'space-y-2.5'}`}>
                {isLoading && !data ? (
                  <>
                    <TicketSkeleton />
                    <TicketSkeleton />
                  </>
                ) : shown.length ? (
                  <>
                    {shown.map((o) =>
                      compact ? (
                        <TicketRow
                          key={o.id}
                          order={o}
                          promiseMinutes={promise}
                          onMove={move}
                          isNew={arrivals.has(o.id)}
                          pending={Boolean(pending[o.id])}
                        />
                      ) : (
                        <Ticket
                          key={o.id}
                          order={o}
                          promiseMinutes={promise}
                          onMove={move}
                          isNew={arrivals.has(o.id)}
                          pending={Boolean(pending[o.id])}
                        />
                      ),
                    )}
                    {hidden > 0 && (
                      <p className="px-1 py-2 text-[12px] text-mute">
                        +{hidden} more — switch to Compact to work through them.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-1 pt-2 text-[12.5px] leading-relaxed text-mute">{col.empty}</p>
                )}
              </div>
            </section>
          );
        })}
      </main>

      {/* ------------------------------------------------------------ legend */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-5 py-2 text-[11.5px] text-mute">
        <span>Rail = time against the {promise} min promise</span>
        <Swatch color="var(--color-s-fresh)" label="on time" />
        <Swatch color="var(--color-s-warm)" label="halfway" />
        <Swatch color="var(--color-s-late)" label="late" />
        <Swatch color="var(--color-s-over)" label="past promise" />
        <span className="ml-auto max-sm:hidden">Board shows open orders only · finished go to History</span>
      </footer>
    </div>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <span className={`flex items-baseline gap-1.5 ${className}`}>
      <span className="eyebrow">{label}</span>
      <span className="tnum font-mono text-[13px] font-medium text-fg">{value}</span>
    </span>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-[3px] rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
