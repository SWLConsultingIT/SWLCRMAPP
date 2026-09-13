import { createBrowserClient } from "@supabase/ssr";

// Singleton — without caching, each provider (Theme, Locale, Brand) creates its
// own GoTrueClient on mount, producing the "Multiple GoTrueClient instances
// detected" warning and burning ~200ms of hydration time across three identical
// auth listeners. We instantiate once per browser context and reuse.
type BrowserClient = ReturnType<typeof createBrowserClient>;
let instance: BrowserClient | null = null;

export function getSupabaseBrowser(): BrowserClient {
  if (typeof window === "undefined") {
    // Defensive: SSR shouldn't import this, but if it does we still return a
    // fresh client (server has no shared singleton context anyway).
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  if (!instance) {
    instance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return instance;
}
