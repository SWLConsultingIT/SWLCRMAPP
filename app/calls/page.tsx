import { supabase } from "@/lib/supabase";
import CallsClient from "@/components/CallsClient";

async function getCallQueue() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, last_step_at, sequence_steps, current_step, leads(id, first_name, last_name, company, role, email, linkedin_url, n8n_flow), sellers(name)")
    .eq("status", "active")
    .eq("channel", "call")
    .order("last_step_at", { ascending: true })
    .limit(100);
  return data ?? [];
}

async function getCallHistory() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, completed_at, leads(id, first_name, last_name, company), sellers(name)")
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
