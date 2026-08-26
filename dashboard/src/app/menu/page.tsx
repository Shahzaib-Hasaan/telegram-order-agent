'use client';

import useSWR from 'swr';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ToastHost, useToast } from '@/components/Toast';
import { rupees } from '@/lib/heat';

const fetcher = (u: string) => fetch(u).then((r) => r.json());

type Product = {
  id: number;
  name: string;
  aliases: string[];
  description: string | null;
  price: number;
  category: string;
  available: boolean;
};

export default function Page() {
  return (
    <ToastHost>
      <Menu />
    </ToastHost>
  );
}

function Menu() {
  const { push } = useToast();
  const { data, mutate, isLoading } = useSWR('/api/menu', fetcher, { refreshInterval: 15000 });
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);

  const products: Product[] = data?.products ?? [];
  const categories = useMemo(() => [...new Set(products.map((p) => p.category))], [products]);
  const soldOut = products.filter((p) => !p.available).length;

  // Search covers aliases too — that is what the bot actually matches on, so
  // "zingr" should find the item even though no customer sees that spelling.
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.category.toLowerCase().includes(t) ||
        p.aliases?.some((a) => a.toLowerCase().includes(t)),
    );
  }, [products, term]);

  async function patch(p: Product, body: any, said: string) {
    const res = await fetch(`/api/menu/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const b = await res.json().catch(() => ({}));
    await mutate();
    push(res.ok ? said : (b?.error ?? 'That change did not save.'), res.ok ? 'ok' : 'error');
  }

  async function remove(p: Product) {
    const res = await fetch(`/api/menu/${p.id}`, { method: 'DELETE' });
    const b = await res.json().catch(() => ({}));
    await mutate();
    push(
      res.ok ? `${p.name} removed from the menu.` : (b?.error ?? 'Could not remove that item.'),
      res.ok ? 'ok' : 'error',
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-ink-950">
      <header className="shrink-0 border-b border-line px-5 py-3">
       <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/" className="text-[13px] text-sub transition-colors hover:text-fg">
          ← Board
        </Link>
        <h1 className="font-display text-[17px] font-bold tracking-tight text-fg">Menu</h1>
        <span className="urdu" lang="ur" dir="rtl">مینو</span>

        <span className="text-[12.5px] text-mute">
          {products.length} items
          {soldOut > 0 && <span className="text-s-late"> · {soldOut} sold out</span>}
        </span>

        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name, category or what the bot hears"
          className="field ml-2 max-w-[340px] flex-1"
          aria-label="Search the menu"
        />

        <button onClick={() => setAdding((v) => !v)} className="btn btn-accent ml-auto">
          {adding ? 'Close' : 'Add item'}
        </button>
       </div>
      </header>

      {adding && (
        <AddItem
          categories={categories}
          onDone={(name) => {
            setAdding(false);
            mutate();
            push(`${name} added to the menu.`, 'ok');
          }}
          onError={(m) => push(m, 'error')}
        />
      )}

      <main className="scroller min-h-0 flex-1 px-5 py-5">
        <div className="mx-auto max-w-[880px]">
          {isLoading && !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton h-[52px] w-full" />
              ))}
            </div>
          ) : !shown.length ? (
            <p className="py-10 text-center text-[13px] text-mute">
              {term ? (
                <>
                  Nothing matches “{term}”.{' '}
                  <button onClick={() => setTerm('')} className="text-s-info hover:underline">
                    Clear search
                  </button>
                </>
              ) : (
                'No items yet. Add the first one.'
              )}
            </p>
          ) : (
            categories
              .filter((cat) => shown.some((p) => p.category === cat))
              .map((cat) => {
                const items = shown.filter((p) => p.category === cat);
                return (
                  <section key={cat} className="mb-7">
                    <div className="mb-2 flex items-baseline gap-2.5">
                      <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.14em] text-sub">
                        {cat}
                      </h2>
                      <span className="tnum font-mono text-[11.5px] text-mute">{items.length}</span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-line">
                      {items.map((p, i) => (
                        <Row
                          key={p.id}
                          p={p}
                          first={i === 0}
                          onPatch={patch}
                          onRemove={remove}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
          )}
        </div>
      </main>
    </div>
  );
}

function Row({
  p,
  first,
  onPatch,
  onRemove,
}: {
  p: Product;
  first: boolean;
  onPatch: (p: Product, b: any, said: string) => Promise<void>;
  onRemove: (p: Product) => void;
}) {
  const [price, setPrice] = useState(String(p.price));
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function savePrice() {
    setEditing(false);
    const n = Number(price);
    if (n === p.price) return;
    if (!Number.isInteger(n) || n < 0) {
      setPrice(String(p.price));
      return;
    }
    await onPatch(p, { price: n }, `${p.name} is now Rs ${rupees(n)}.`);
  }

  return (
    <div
      className={`flex items-center gap-3 bg-ink-900 px-3.5 py-2.5 transition-colors hover:bg-ink-850 ${
        first ? '' : 'border-t border-line'
      } ${p.available ? '' : 'opacity-55'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13.5px] text-fg">
          {p.name}
          {!p.available && (
            <span className="rounded-full bg-s-late/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-s-late">
              Sold out
            </span>
          )}
        </p>
        {p.aliases?.length > 0 && (
          <p
            className="mt-0.5 truncate font-mono text-[11px] text-mute"
            title="What the bot listens for when a customer types"
          >
            {p.aliases.slice(0, 6).join(' · ')}
            {p.aliases.length > 6 && ` +${p.aliases.length - 6}`}
          </p>
        )}
      </div>

      {editing ? (
        <input
          autoFocus
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={savePrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') savePrice();
            if (e.key === 'Escape') {
              setPrice(String(p.price));
              setEditing(false);
            }
          }}
          className="field tnum w-24 text-right font-mono"
          aria-label={`Price for ${p.name}`}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          title="Change price"
          className="tnum w-24 rounded-md border border-transparent px-2 py-1.5 text-right font-mono text-[13.5px] text-fg transition-colors hover:border-line-strong"
        >
          Rs {rupees(p.price)}
        </button>
      )}

      <button
        onClick={() =>
          onPatch(
            p,
            { available: !p.available },
            p.available ? `${p.name} marked sold out.` : `${p.name} is back on.`,
          )
        }
        className="btn btn-ghost w-[86px] !min-h-[30px] !text-[12px]"
      >
        {p.available ? 'Sell out' : 'Restock'}
      </button>

      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            onClick={() => onRemove(p)}
            className="btn btn-ghost btn-danger !min-h-[30px] !px-2 !text-[12px] !text-s-over"
          >
            Remove
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="btn btn-ghost !min-h-[30px] !px-2 !text-[12px]"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${p.name}`}
          title="Remove from menu — past orders keep their own copy"
          className="w-[68px] shrink-0 text-[12px] text-mute transition-colors hover:text-s-over"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function AddItem({
  categories,
  onDone,
  onError,
}: {
  categories: string[];
  onDone: (name: string) => void;
  onError: (m: string) => void;
}) {
  const [f, setF] = useState({ name: '', price: '', category: categories[0] ?? '', aliases: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, price: Number(f.price) }),
    });
    if (res.ok) onDone(f.name);
    else onError((await res.json().catch(() => ({})))?.error ?? 'Could not add that item.');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="rise shrink-0 border-b border-line bg-ink-900 px-5 py-4">
      <div className="mx-auto flex max-w-[880px] flex-wrap items-end gap-3">
        <Field label="Name" className="min-w-[170px] flex-1">
          <input
            required
            autoFocus
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            className="field"
            placeholder="Chicken Handi"
          />
        </Field>
        <Field label="Price">
          <input
            required
            type="number"
            min={0}
            value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })}
            className="field tnum w-24 font-mono"
            placeholder="0"
          />
        </Field>
        <Field label="Category">
          <input
            required
            list="cats"
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
            className="field w-36"
          />
          <datalist id="cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="What the bot should hear" className="min-w-[200px] flex-1">
          <input
            value={f.aliases}
            onChange={(e) => setF({ ...f, aliases: e.target.value })}
            placeholder="handi, chicken handi, hundi"
            className="field font-mono !text-[12px]"
          />
        </Field>
        <button disabled={busy} className="btn btn-accent">
          {busy ? 'Adding…' : 'Add to menu'}
        </button>
      </div>
      <p className="mx-auto mt-2.5 max-w-[880px] text-[11.5px] text-mute">
        Aliases are how customers actually type. Add the misspellings and the Roman Urdu —
        “zingr”, “adha karahi”, “thanda” — or the bot will not find the item.
      </p>
    </form>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
