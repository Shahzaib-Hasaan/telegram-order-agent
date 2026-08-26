import { Pool } from 'pg';

// Supabase signs its pooler certs with its own CA ("Supabase Intermediate 2021
// CA"), which Node does not ship, so the chain fails to verify by default.
//
// Set SUPABASE_CA_CERT to the PEM from Project Settings > Database > SSL
// Configuration and we verify the chain properly. Without it we fall back to
// encrypted-but-unverified, which is what `sslmode=require` does and what the
// n8n side runs on. Prefer setting the cert — it closes the MITM gap on the
// hop between Vercel and Supabase.
const ca = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, '\n');
const ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };

const globalForPg = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool;

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function q1<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export const STATUSES = ['new', 'preparing', 'on_the_way', 'delivered'] as const;
export type Status = (typeof STATUSES)[number] | 'cancelled';

/** The single forward path a ticket takes through the kitchen. */
export const NEXT_STATUS: Record<string, Status | null> = {
  new: 'preparing',
  preparing: 'on_the_way',
  on_the_way: 'delivered',
  delivered: null,
  cancelled: null,
};
