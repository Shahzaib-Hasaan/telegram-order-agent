import { NextResponse } from 'next/server';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

const OPEN = ['new', 'preparing', 'on_the_way'];

/**
 * The live board.
 *
 * Only open orders. This is the whole scaling story: the set of orders that
 * are actually cooking stays at 10-40 however busy the day gets, so this
 * payload is flat whether the shop does 40 covers or 4000. Finished orders
 * live at /api/orders/history, which pages.
 *
 * The previous version also pulled 12 hours of delivered orders on every
 * 3-second poll — ~363 KB at 1000 orders/day, about 425 MB/hour of egress
 * against a 5 GB monthly allowance.
 *
 * `?since=<iso>` returns only rows touched since then, plus the ids that are
 * no longer open so the client can drop them. That keeps a steady-state poll
 * at a few hundred bytes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get('since');

  const cfg = await q1<{ eta_minutes: string; name: string }>(
    `SELECT eta_minutes, name FROM shop_config WHERE id = 1`,
  );
  // "35-45" -> 45: the upper bound is the number the customer was given.
  const promise = Number(String(cfg?.eta_minutes ?? '45').split('-').pop()) || 45;

  const select = `
    SELECT
      o.id, o.status, o.subtotal, o.delivery_fee, o.total, o.note,
      o.customer_tg_id                                AS chat_id,
      o.delivery_name                                 AS name,
      o.delivery_phone                                AS phone,
      o.delivery_address                              AS address,
      o.created_at, o.updated_at,
      EXTRACT(EPOCH FROM (now() - o.created_at))::int AS age_seconds,
      COALESCE((
        SELECT json_agg(json_build_object('name', oi.product_name, 'qty', oi.qty, 'line', oi.line_total)
                        ORDER BY oi.id)
          FROM order_items oi WHERE oi.order_id = o.id
      ), '[]'::json)                                  AS items
    FROM orders o
   WHERE o.status = ANY($1)`;

  let orders;
  let closedIds: number[] = [];

  if (since) {
    orders = await q(`${select} AND o.updated_at > $2 ORDER BY o.id DESC`, [OPEN, since]);
    // Anything that left the open set since the last tick, so the client can drop it.
    closedIds = (
      await q<{ id: number }>(
        `SELECT id FROM orders
          WHERE updated_at > $1 AND NOT (status = ANY($2))`,
        [since, OPEN],
      )
    ).map((r) => r.id);
  } else {
    orders = await q(`${select} ORDER BY o.id DESC`, [OPEN]);
  }

  return NextResponse.json({
    orders,
    closedIds,
    delta: Boolean(since),
    shop: cfg?.name ?? 'Tandoor & Bun',
    promiseMinutes: promise,
    // Postgres clock, so client and server never disagree about "now".
    now: (await q1<{ now: string }>(`SELECT now()::text AS now`))?.now,
  });
}
