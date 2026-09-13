import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Memoized per-request via React's `cache`. Many pages call
// `getSupabaseServer()` in 2-3 places (the page itself, a helper, the
// layout). Without memoization each call recreates the SSR client and
// re-reads cookies — small but adds up across navigation.
export const getSupabaseServer = cache(async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — middleware handles setting cookies.
          }
        },
      },
    }
  );
});
