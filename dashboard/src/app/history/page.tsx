'use client';

import useSWR from 'swr';
import { useState } from 'react';
import Link from 'next/link';
import { rupees, shortTime } from '@/lib/heat';

const fetcher = (u: string) => fetch(u).then((r) => r.json());

type Row = {
  id: number;
  status: string;
  total: number;
  name: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  items: { name: string; qty: number; line: number }[];
};

export default function History() {
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState<(number | null)[]>([null]);

  // Keyset paging: each page asks for ids below the previous page's last id,
  // so page 40 costs the same as page 1.
  const key = (cursor: number | null) =>
    `/api/orders/history?${new URLSearchParams({
      ...(cursor ? { cursor: String(cursor) } : {}),
      ...(term ? { q: term } : {}),
      ...(status ? { status } : {}),
    })}`;

  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <header className="shrink-0 border-b border-line px-5 py-3">
       <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/" className="text-[13px] text-sub transition-colors hover:text-fg">← Board</Link>
        <h1 className="font-display text-[17px] font-bold tracking-tight text-fg">History</h1>

        <input
          value={term}
          onChange={(e) => { setTerm(e.target.value); setPages([null]); }}
          placeholder="Order number, phone, name or item"
          className="field ml-2 max-w-[320px] flex-1"
          aria-label="Search finished orders"
        />

        <div className="flex items-center gap-1.5">
          {[['', 'All'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => { setStatus(v); setPages([null]); }}
              className={`btn !min-h-[30px] !px-2.5 !text-[12px] ${status === v ? 'btn-primary' : 'btn-ghost'}`}
            >
              {l}
            </button>
          ))}
        </div>
       </div>
      </header>

      <main className="scroller min-h-0 flex-1 px-5 py-4">
        <div className="mx-auto max-w-[900px]">
          <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-b border-line pb-2">
            <span className="eyebrow">Order</span>
            <span className="eyebrow">Items</span>
            <span className="eyebrow text-right">Total</span>
            <span className="eyebrow text-right">Time</span>
          </div>
          {pages.map((cursor, i) => (
            <Page key={i} url={key(cursor)} onEnd={(next) => {
              if (next && !pages.includes(next)) setPages((p) => [...p, next]);
            }} isLast={i === pages.length - 1} />
          ))}
        </div>
      </main>
    </div>
  );
}

function Page({ url, onEnd, isLast }: { url: string; onEnd: (c: number | null) => void; isLast: boolean }) {
  const { data, isLoading } = useSWR(url, fetcher, { revalidateOnFocus: false });
  const rows: Row[] = data?.orders ?? [];

  if (isLoading) {
    return (
      <div className="space-y-1 py-2">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-[38px] w-full" />)}
      </div>
    );
  }
  if (!rows.length) {
    return isLast ? <p className="py-6 text-[13px] text-mute">No orders match that.</p> : null;
  }

  return (
    <>
      {rows.map((o) => (
        <div
          key={o.id}
          className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-b border-line/60 py-2.5 text-[13px]"
        >
          <span className="tnum w-12 font-mono font-semibold text-fg">
            <span className="text-mute">#</span>{o.id}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sub">
              {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
            </span>
            <span className="block truncate text-[11.5px] text-mute">
              {o.name ?? '—'}
              {o.phone ? ` · ${o.phone}` : ''}
            </span>
          </span>
          <span
            className={`tnum text-right font-mono ${
              o.status === 'cancelled' ? 'text-mute line-through' : 'text-fg'
            }`}
          >
            {rupees(o.total)}
          </span>
          <span className="tnum w-16 text-right font-mono text-[12px] text-mute">
            {shortTime(o.created_at)}
          </span>
        </div>
      ))}
      {isLast && data?.nextCursor && (
        <button onClick={() => onEnd(data.nextCursor)} className="btn btn-ghost mt-4 w-full">
          Load 50 more
        </button>
      )}
    </>
  );
}
