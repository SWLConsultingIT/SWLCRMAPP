import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import CallsClient from "@/components/CallsClient";

// Decrypts nested `leads` for client-source rows. Without this, every call
// queue / history row for tenants with encrypted PII (eg De Vera Grill)
// renders the lead as "Unknown".
async function hydrateNested<T extends { leads?: any }>(rows: T[]): Promise<T[]> {
  const nested = rows.map(r => r.leads).filter(Boolean) as Record<string, unknown>[];
  if (nested.length === 0) return rows;
  const hydrated = await hydrateClientLeads(nested);
  const byId = new Map(hydrated.map(l => [(l as any).id as string, l]));
  return rows.map(r => (r.leads ? { ...r, leads: byId.get((r.leads as any).id) ?? r.leads } : r));
}

async function getCallQueue() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, last_step_at, sequence_steps, current_step, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, n8n_flow), sellers(name)")
    .eq("status", "active")
    .eq("channel", "call")
    .order("last_step_at", { ascending: true })
    .limit(100);
  return await hydrateNested((data ?? []) as any[]);
}

async function getCallHistory() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, completed_at, leads(id, source, encrypted_payload, company_bio_id, primary_first_name, primary_last_name, company_name), sellers(name)")
    .eq("channel", "call")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(25);
  return await hydrateNested((data ?? []) as any[]);
}

export default async function CallsPage() {
  const [queue, history] = await Promise.all([getCallQueue(), getCallHistory()]);
  return <CallsClient initialQueue={queue as any} history={history as any} />;
}
