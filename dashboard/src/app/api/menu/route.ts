import { NextResponse } from 'next/server';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await q(`
    SELECT id, name, aliases, description, price, category, available, sort_order
      FROM products ORDER BY sort_order, id`);
  return NextResponse.json({ products: rows });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b?.name ?? '').trim();
  const category = String(b?.category ?? '').trim();
  const price = Number(b?.price);

  if (!name) return NextResponse.json({ error: 'Give the item a name.' }, { status: 400 });
  if (!category) return NextResponse.json({ error: 'Pick a category.' }, { status: 400 });
  if (!Number.isInteger(price) || price < 0) {
    return NextResponse.json({ error: 'Price must be a whole number of rupees.' }, { status: 400 });
  }

  // Aliases are what lets the bot understand "zingr" and "adha karahi", so we
  // always seed one from the name rather than leaving a new item unmatched.
  const aliases: string[] = Array.isArray(b?.aliases)
    ? b.aliases.map((a: any) => String(a).trim().toLowerCase()).filter(Boolean)
    : String(b?.aliases ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!aliases.length) aliases.push(name.toLowerCase());

  const row = await q1(
    `INSERT INTO products (name, aliases, description, price, category, sort_order)
     VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT max(sort_order) FROM products), 0) + 10)
     RETURNING *`,
    [name, aliases, String(b?.description ?? '').trim() || null, price, category],
  );
  return NextResponse.json({ product: row }, { status: 201 });
}
