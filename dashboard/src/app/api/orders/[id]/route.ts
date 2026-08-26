import { NextResponse } from 'next/server';
import { q, q1, NEXT_STATUS, STATUSES } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** How long after a move the kitchen can still take it back. */
const UNDO_WINDOW_SECONDS = 120;

/**
 * Move a ticket. Telling the customer is somebody else's job — see the note
 * at the bottom of this handler.
 *
 * Guarded server-side: normally you may only advance one step along the
 * kitchen's real sequence, or cancel. `revert: true` additionally allows one
 * step BACKWARD, but only inside the undo window — so a mis-tap is recoverable
 * while yesterday's orders stay immutable.
 *
 * The UPDATE is conditional on the status we just read, so two people tapping
 * the same ticket at once cannot both win.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Bad order number.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const to = String(body?.status ?? '');
  const isRevert = body?.revert === true;

  if (to !== 'cancelled' && !STATUSES.includes(to as any)) {
    return NextResponse.json({ error: `"${to}" is not a status.` }, { status: 400 });
  }

  const current = await q1<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [id]);
  if (!current) return NextResponse.json({ error: `Order #${id} not found.` }, { status: 404 });

  const pretty = (s: string) => s.replace(/_/g, ' ');

  if (isRevert) {
    const last = await q1<{ secs: number }>(
      `SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS secs
         FROM order_status_events WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
      [id],
    );
    if (!last || last.secs > UNDO_WINDOW_SECONDS) {
      return NextResponse.json(
        { error: `Too late to undo — order #${id} moved more than 2 minutes ago.` },
        { status: 409 },
      );
    }
    if (NEXT_STATUS[to] !== current.status && current.status !== 'cancelled') {
      return NextResponse.json(
        { error: `Order #${id} can't go back to ${pretty(to)}.` },
        { status: 409 },
      );
    }
  } else {
    if (current.status === 'delivered' || current.status === 'cancelled') {
      return NextResponse.json(
        { error: `Order #${id} is already ${pretty(current.status)}.` },
        { status: 409 },
      );
    }
    if (to !== 'cancelled' && NEXT_STATUS[current.status] !== to) {
      return NextResponse.json(
        { error: `Order #${id} is ${pretty(current.status)} — it can't jump to ${pretty(to)}.` },
        { status: 409 },
      );
    }
  }

  const updated = await q1<any>(
    `UPDATE orders SET status = $1 WHERE id = $2 AND status = $3
       RETURNING id, status, total, delivery_address, customer_tg_id`,
    [to, id, current.status],
  );
  if (!updated) {
    return NextResponse.json({ error: 'Someone else just moved that order.' }, { status: 409 });
  }

  // A revert stays silent. The customer already got the forward message, and a
  // correction ("actually, not yet") reads worse than saying nothing.
  if (isRevert) {
    await q(
      `UPDATE order_status_events SET notified = true
        WHERE order_id = $1 AND to_status = $2 AND NOT notified`,
      [id, to],
    );
    return NextResponse.json({ ok: true, id, status: to, notified: false, reverted: true });
  }

  // The dashboard does NOT message the customer itself. The status trigger has
  // already written an unsent row to order_status_events, and the n8n Status
  // Notifier drains that queue every 20s from New Jersey.
  //
  // Two reasons it lives there and not here: this app may run from Pakistan,
  // where Telegram is blocked outright, and a single owner of the send means a
  // customer can never be messaged twice about the same transition.
  return NextResponse.json({ ok: true, id, status: to, queued: true });
}
