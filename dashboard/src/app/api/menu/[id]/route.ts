import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad item id.' }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];

  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    sets.push(`name = $${vals.push(n)}`);
  }
  if (b.price !== undefined) {
    const p = Number(b.price);
    if (!Number.isInteger(p) || p < 0) {
      return NextResponse.json({ error: 'Price must be a whole number of rupees.' }, { status: 400 });
    }
    sets.push(`price = $${vals.push(p)}`);
  }
  if (b.available !== undefined) sets.push(`available = $${vals.push(Boolean(b.available))}`);
  if (b.category !== undefined) sets.push(`category = $${vals.push(String(b.category).trim())}`);
  if (b.description !== undefined) sets.push(`description = $${vals.push(String(b.description).trim() || null)}`);
  if (b.aliases !== undefined) {
    const a = (Array.isArray(b.aliases) ? b.aliases : String(b.aliases).split(','))
      .map((x: any) => String(x).trim().toLowerCase()).filter(Boolean);
    sets.push(`aliases = $${vals.push(a)}`);
  }

  if (!sets.length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

  vals.push(id);
  const row = await q1(`UPDATE products SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!row) return NextResponse.json({ error: 'That item no longer exists.' }, { status: 404 });
  return NextResponse.json({ product: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad item id.' }, { status: 400 });

  // Past orders keep their own copy of the name and price, so removing an item
  // here never rewrites history. order_items.product_id just goes null.
  const row = await q1(`DELETE FROM products WHERE id = $1 RETURNING id, name`, [id]);
  if (!row) return NextResponse.json({ error: 'That item no longer exists.' }, { status: 404 });
  return NextResponse.json({ ok: true, removed: row });
}
