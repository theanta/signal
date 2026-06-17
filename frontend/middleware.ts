import { NextRequest, NextResponse } from 'next/server';

// Cookie presence is a fast UX gate only — real auth is enforced by the backend.
// If the cookie is present but expired, the API returns 401 and the axios
// interceptor redirects to /login.
export function middleware(request: NextRequest) {
  const hasRefreshCookie = request.cookies.has('refreshToken');
  const isLoginPage = request.nextUrl.pathname.startsWith('/login');

  if (!hasRefreshCookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasRefreshCookie && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on app pages only — skip Next.js internals, static assets, and /api/*
  // (API routes are proxied to the backend and must not be redirected)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|api/).*)'],
};
