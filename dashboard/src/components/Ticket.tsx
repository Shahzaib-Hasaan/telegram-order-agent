'use client';

import { useState } from 'react';
import { toneOf, railFill, TONE_VAR, TONE_MEANING, elapsed, rupees } from '@/lib/heat';

export type Order = {
  id: number;
  status: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  note: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  age_seconds: number;
  items: { name: string; qty: number; line: number }[];
};

export const ADVANCE: Record<string, { label: string; short: string; to: string }> = {
  new: { label: 'Start cooking', short: 'Start', to: 'preparing' },
  preparing: { label: 'Hand to rider', short: 'Rider', to: 'on_the_way' },
  on_the_way: { label: 'Mark delivered', short: 'Done', to: 'delivered' },
};

type Props = {
  order: Order;
  promiseMinutes: number;
  onMove: (order: Order, to: string) => void;
  isNew?: boolean;
  pending?: boolean;
};

/* ------------------------------------------------------------------ card */

export function Ticket({ order, promiseMinutes, onMove, isNew, pending }: Props) {
  const [open, setOpen] = useState(false);

  const tone = toneOf(order.age_seconds, promiseMinutes);
  const next = ADVANCE[order.status];
  const count = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <article
      className={`card p-4 ${isNew ? 'arrive' : ''}`}
      data-over={tone === 3 ? 'true' : undefined}
      data-pending={pending ? 'true' : undefined}
      aria-busy={pending}
      style={
        {
          '--tone': TONE_VAR[tone],
          '--rail': `${railFill(order.age_seconds, promiseMinutes)}%`,
        } as React.CSSProperties
      }
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[17px] font-bold tracking-tight text-fg">
          <span className="text-mute">#</span>
          {order.id}
        </h3>
        <span
          className="tnum inline-flex items-center gap-1.5 font-mono text-[13px] font-medium"
          style={{ color: TONE_VAR[tone] }}
          title={`${elapsed(order.age_seconds)} — ${TONE_MEANING[tone]}`}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: TONE_VAR[tone] }}
          />
          {elapsed(order.age_seconds)}
          <span className="sr-only"> — {TONE_MEANING[tone]}</span>
        </span>
      </header>

      <ul className="mt-3 space-y-1.5">
        {order.items.map((it, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-[14px] leading-snug">
            <span className="text-fg">
              <span className="tnum mr-1 font-mono text-[13px] text-mute">{it.qty}×</span>
              {it.name}
            </span>
            <span className="tnum shrink-0 font-mono text-[12.5px] text-mute">
              {rupees(it.line)}
            </span>
          </li>
        ))}
      </ul>

      {order.note && (
        <p className="mt-3 rounded-md border-l-2 border-s-warm bg-s-warm/10 py-1.5 pl-2.5 pr-2 text-[12.5px] leading-snug text-s-warm">
          {order.note}
        </p>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="tnum font-mono text-[15px] font-semibold text-fg">
          Rs {rupees(order.total)}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="eyebrow transition-colors hover:text-fg"
          aria-expanded={open}
        >
          {open ? 'Hide' : `${count} item${count === 1 ? '' : 's'}`}
        </button>
      </div>

      {open && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-md bg-ink-950/70 p-3 text-[12.5px]">
          <dt className="text-mute">Name</dt>
          <dd className="text-sub">{order.name ?? '—'}</dd>
          <dt className="text-mute">Phone</dt>
          <dd>
            {order.phone ? (
              <a href={`tel:${order.phone}`} className="font-mono text-s-info hover:underline">
                {order.phone}
              </a>
            ) : (
              <span className="text-sub">—</span>
            )}
          </dd>
          <dt className="text-mute">Address</dt>
          <dd className="leading-snug text-sub">{order.address ?? '—'}</dd>
          <dt className="text-mute">Delivery</dt>
          <dd className="tnum font-mono text-sub">
            {order.delivery_fee === 0 ? 'free' : `Rs ${rupees(order.delivery_fee)}`}
          </dd>
        </dl>
      )}

      {next && (
        <div className="mt-3.5 flex gap-2">
          <button
            onClick={() => onMove(order, next.to)}
            disabled={pending}
            className="btn btn-primary flex-1"
          >
            {next.label}
          </button>
          <button
            onClick={() => onMove(order, 'cancelled')}
            disabled={pending}
            aria-label={`Cancel order #${order.id}`}
            className="btn btn-ghost btn-danger !px-2.5"
          >
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------- row
   What a column becomes when the rush is on. Same information hierarchy,
   a fifth of the height, so 20+ tickets fit instead of 4. */

export function TicketRow({ order, promiseMinutes, onMove, isNew, pending }: Props) {
  const tone = toneOf(order.age_seconds, promiseMinutes);
  const next = ADVANCE[order.status];
  const count = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <div
      className={`row ${isNew ? 'rise' : ''} ${pending ? 'opacity-45' : ''}`}
      style={{ '--tone': TONE_VAR[tone] } as React.CSSProperties}
      aria-busy={pending}
    >
      <span className="tnum font-mono text-[13.5px] font-bold text-fg">{order.id}</span>

      <span className="min-w-0 truncate text-[13px] text-sub" title={order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}>
        {order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
      </span>

      <span className="tnum hidden font-mono text-[12.5px] text-mute sm:inline">
        {count} · Rs {rupees(order.total)}
      </span>

      <span className="flex items-center gap-2">
        <span
          className="tnum w-[52px] shrink-0 whitespace-nowrap text-right font-mono text-[12.5px] font-medium"
          style={{ color: TONE_VAR[tone] }}
          title={TONE_MEANING[tone]}
        >
          {elapsed(order.age_seconds)}
        </span>
        {next && (
          <button
            onClick={() => onMove(order, next.to)}
            disabled={pending}
            className="btn btn-ghost !min-h-[26px] !px-2 !text-[11.5px]"
            title={next.label}
          >
            {next.short}
          </button>
        )}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- skeleton */

export function TicketSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex justify-between">
        <div className="skeleton h-[17px] w-12" />
        <div className="skeleton h-[13px] w-10" />
      </div>
      <div className="mt-3.5 space-y-2">
        <div className="skeleton h-[14px] w-4/5" />
        <div className="skeleton h-[14px] w-3/5" />
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="skeleton h-[15px] w-24" />
      </div>
      <div className="mt-3.5 flex gap-2">
        <div className="skeleton h-[34px] flex-1" />
      </div>
    </div>
  );
}
