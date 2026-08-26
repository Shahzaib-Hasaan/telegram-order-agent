import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { valid, COOKIE_NAME } from '@/lib/session';

// Async because session verification uses Web Crypto (Edge has no node:crypto).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/session') return NextResponse.next();

  if (await valid(req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
