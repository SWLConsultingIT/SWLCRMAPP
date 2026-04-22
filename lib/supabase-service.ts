import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely.
// ONLY use server-side: admin pages, webhooks, n8n callbacks, data imports.
// NEVER import this in client components or expose to the browser.
export function getSupabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );
}
