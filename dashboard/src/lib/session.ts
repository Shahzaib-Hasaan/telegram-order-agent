const COOKIE = 'tandoor_pass';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

// Web Crypto, not node:crypto. Middleware runs on the Edge runtime, which has
// no Node built-ins — importing createHmac there throws at request time and
// every route 500s. Web Crypto is available in both runtimes, at the cost of
// these functions being async.
const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare without leaking where two strings first differ. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** token = <expiry-epoch>.<hmac> — no user table, this is one shared login. */
export async function issue(): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${exp}.${await hmac(exp)}`;
}

export async function valid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, mac] = token.split('.');
  if (!exp || !mac) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(await hmac(exp), mac);
}

/** Hash both sides first so the compare never runs over the raw password. */
export async function passwordMatches(given: string): Promise<boolean> {
  const real = process.env.DASHBOARD_PASSWORD ?? '';
  if (!real) return false;
  return safeEqual(await hmac(given), await hmac(real));
}

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAX_AGE = MAX_AGE;
