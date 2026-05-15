import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from './types';

/**
 * Cookie-auth Supabase client for server components / route handlers.
 *
 * IMPORTANT: Do NOT use this client for Storage operations.
 * @supabase/ssr 0.10 has a known bug where the user JWT is not
 * forwarded to /storage/v1/* requests, causing RLS denials on uploads.
 * For Storage, use the admin (service-role) client below.
 *
 * See project memory: feedback_supabase_ssr_storage_rls
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — Next will refresh on next nav
          }
        },
      },
    },
  );
}
