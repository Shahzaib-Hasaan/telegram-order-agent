import { NextResponse } from 'next/server';
import { issue, passwordMatches, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/session';

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  if (!(await passwordMatches(String(password ?? '')))) {
    // Deliberately vague: never confirm whether a password exists.
    return NextResponse.json({ error: "That password doesn't work." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await issue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
