// TEST STUB — replaces @/lib/supabase-server for the render harness ONLY.
// The real one builds a client bound to the request's auth cookies. A script
// has none, so this returns a service-key client. READ ONLY by discipline:
// the harness calls getDashboardData and nothing else, and getDashboardData
// issues only SELECTs.
import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;
export async function getSupabaseServer() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}
export const createServerSupabase = getSupabaseServer;
