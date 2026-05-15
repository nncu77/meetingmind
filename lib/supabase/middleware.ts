import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';

/**
 * Standard @supabase/ssr session-refresh middleware.
 *
 * - Refreshes the session cookie on every request so JWTs don't expire mid-session
 * - Redirects unauthenticated users to /login (except for public routes)
 *
 * IMPORTANT: keep the `await supabase.auth.getUser()` call here — it's what
 * triggers the cookie refresh. Don't be tempted to remove it just because
 * you don't read the user.
 */

const PUBLIC_ROUTES = ['/login', '/signup', '/api/auth/callback', '/api/inngest'];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // Logged-in user trying to hit /login or /signup → bounce to /meetings
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/meetings';
    return NextResponse.redirect(url);
  }

  // Unauthenticated user on protected route → /login?next=...
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
