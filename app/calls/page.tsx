import { getSupabaseServer } from "@/lib/supabase-server";
import CallsClient from "@/components/CallsClient";

async function getCallQueue() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, last_step_at, sequence_steps, current_step, leads(id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_work_email, primary_linkedin_url, n8n_flow), sellers(name)")
    .eq("status", "active")
    .eq("channel", "call")
    .order("last_step_at", { ascending: true })
    .limit(100);
  return data ?? [];
}

async function getCallHistory() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("campaigns")
    .select("id, completed_at, leads(id, primary_first_name, primary_last_name, company_name), sellers(name)")
    .eq("channel", "call")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(25);
  return data ?? [];
}

export default async function CallsPage() {
  const [queue, history] = await Promise.all([getCallQueue(), getCallHistory()]);
  return <CallsClient initialQueue={queue as any} history={history as any} />;
}
