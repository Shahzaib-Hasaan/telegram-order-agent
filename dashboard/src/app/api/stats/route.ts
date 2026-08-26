import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

// "Today" is Pakistan Standard Time, not UTC — a 1am order belongs to the
// night shift that cooked it, and the staff reading this live in PKT.
export async function GET() {
  const row = await q1<any>(`
    WITH today AS (
      SELECT * FROM orders
       WHERE (created_at AT TIME ZONE 'Asia/Karachi')::date
           = (now()      AT TIME ZONE 'Asia/Karachi')::date
    )
    SELECT
      (SELECT count(*) FROM today WHERE status <> 'cancelled')                  AS orders,
      (SELECT COALESCE(sum(total),0) FROM today WHERE status <> 'cancelled')    AS revenue,
      (SELECT count(*) FROM today WHERE status IN ('new','preparing','on_the_way')) AS open_now,
      (SELECT count(*) FROM today WHERE status = 'cancelled')                   AS cancelled,
      (SELECT COALESCE(round(avg(total)),0) FROM today WHERE status <> 'cancelled') AS avg_ticket,
      (SELECT product_name FROM order_items oi
         JOIN today t ON t.id = oi.order_id
        GROUP BY product_name ORDER BY sum(oi.qty) DESC LIMIT 1)                AS top_item
  `);
  return NextResponse.json(row ?? {});
}
