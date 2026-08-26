import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PAGE = 50;

/**
 * Finished orders, paged.
 *
 * Keyset pagination on id, not OFFSET: at page 20 of a busy month OFFSET makes
 * Postgres walk and discard every row before it, while `id < cursor` is a
 * single index seek no matter how deep you go.
 *
 * Search covers the three things staff actually look up — an order number, a
 * customer's phone, or "who ordered the BBQ platter".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cursor = Number(url.searchParams.get('cursor') ?? 0);
  const term = (url.searchParams.get('q') ?? '').trim();
  const status = url.searchParams.get('status') ?? '';

  const where: string[] = [`o.status IN ('delivered','cancelled')`];
  const vals: any[] = [];

  if (status === 'delivered' || status === 'cancelled') {
    where[0] = `o.status = $${vals.push(status)}`;
  }
  if (cursor > 0) where.push(`o.id < $${vals.push(cursor)}`);

  if (term) {
    const digits = term.replace(/\D/g, '');
    const asId = /^#?\d+$/.test(term) ? Number(term.replace('#', '')) : null;
    const p = vals.push(`%${term}%`);
    const phone = vals.push(`%${digits || '\u0000'}%`);
    const idv = vals.push(asId ?? -1);
    where.push(`(
      o.id = $${idv}
      OR o.delivery_phone ILIKE $${phone}
      OR o.delivery_name  ILIKE $${p}
      OR EXISTS (SELECT 1 FROM order_items oi
                  WHERE oi.order_id = o.id AND oi.product_name ILIKE $${p})
    )`);
  }

  const rows = await q(`
    SELECT o.id, o.status, o.total, o.delivery_name AS name, o.delivery_phone AS phone,
           o.delivery_address AS address, o.created_at,
           COALESCE((
             SELECT json_agg(json_build_object('name', oi.product_name, 'qty', oi.qty, 'line', oi.line_total)
                             ORDER BY oi.id)
               FROM order_items oi WHERE oi.order_id = o.id
           ), '[]'::json) AS items
      FROM orders o
     WHERE ${where.join(' AND ')}
     ORDER BY o.id DESC
     LIMIT ${PAGE + 1}`, vals);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;

  return NextResponse.json({
    orders: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
