// Returns active/paused campaigns (a.k.a. "flows") for the current tenant
// with the metadata needed by the "Add to existing flow" modal:
// flow name, channel, status, lead count, last activity, current step.
//
// Used by the Lead Miner ticket detail page when the user picks "Add to
// existing flow" with a set of leads selected — the modal lets them pick
// which flow to push the leads into. Boss feedback 2026-05-28.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getUserScope } from "@/lib/scope";

export async function GET(_req: NextRequest) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId : null;

  // Campaigns have one row per lead-attached-to-flow, so we aggregate by
  // name (the "flow") and count distinct leads. last_step_at gives us the
  // freshness signal — flows that haven't fired in a while feel stale.
  const q = supabase
    .from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, last_step_at, started_at, lead_id, leads!inner(company_bio_id)")
    .in("status", ["active", "paused"]);
  const { data, error } = bioId ? await q.eq("leads.company_bio_id", bioId) : await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; name: string; status: string; channel: string | null; current_step: number | null; sequence_steps: unknown; last_step_at: string | null; started_at: string | null; lead_id: string | null };
  const rows = (data ?? []) as unknown as Row[];

  type FlowAgg = {
    name: string;
    status: "active" | "paused" | "mixed";
    channels: Set<string>;
    leads: Set<string>;
    activeLeads: number;
    pausedLeads: number;
    currentStep: number;
    totalSteps: number;
    lastStepAt: string | null;
    startedAt: string | null;
  };
  const byName = new Map<string, FlowAgg>();
  for (const r of rows) {
    let g = byName.get(r.name);
    if (!g) {
      const totalSteps = Array.isArray(r.sequence_steps) ? (r.sequence_steps as unknown[]).length : 0;
      g = {
        name: r.name,
        status: r.status as "active" | "paused",
        channels: new Set(),
        leads: new Set(),
        activeLeads: 0,
        pausedLeads: 0,
        currentStep: r.current_step ?? 0,
        totalSteps,
        lastStepAt: r.last_step_at,
        startedAt: r.started_at,
      };
      byName.set(r.name, g);
    }
    if (r.channel) g.channels.add(r.channel);
    if (r.lead_id) g.leads.add(r.lead_id);
    if (r.status === "active") g.activeLeads++;
    else if (r.status === "paused") g.pausedLeads++;
    // Promote status to mixed if we see both states under the same name.
    if (r.status === "active" && g.status === "paused") g.status = "mixed";
    if (r.status === "paused" && g.status === "active") g.status = "mixed";
    // Prefer the most-recent last_step_at across the group.
    if (r.last_step_at && (!g.lastStepAt || r.last_step_at > g.lastStepAt)) g.lastStepAt = r.last_step_at;
    if (r.started_at && (!g.startedAt || r.started_at < g.startedAt)) g.startedAt = r.started_at;
  }

  const flows = Array.from(byName.values()).map(g => ({
    name: g.name,
    status: g.status,
    channels: Array.from(g.channels),
    leadCount: g.leads.size,
    activeLeads: g.activeLeads,
    pausedLeads: g.pausedLeads,
    currentStep: g.currentStep,
    totalSteps: g.totalSteps,
    lastStepAt: g.lastStepAt,
    startedAt: g.startedAt,
  })).sort((a, b) => {
    // Most-active first (active > mixed > paused), then by recent activity.
    const rank = (s: string) => s === "active" ? 2 : s === "mixed" ? 1 : 0;
    const r = rank(b.status) - rank(a.status);
    if (r !== 0) return r;
    return (b.lastStepAt ?? "").localeCompare(a.lastStepAt ?? "");
  });

  return NextResponse.json({ flows });
}
