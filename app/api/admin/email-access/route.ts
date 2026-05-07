import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

// SWL super-admin cross-workspace view of inboxes available for assignment.
//
// Returns one logical "section" per registered Instantly workspace plus the
// env-var fallback (if INSTANTLY_API_KEY is set and not already represented
// by a registered workspace). For each section we hit Instantly's
// /api/v2/accounts with the corresponding key and list the inboxes.
//
// Each tenant (company_bios row) lists its own current `email_accounts` so
// the UI can show "this inbox is assigned to X" inline.
//
// PATCH: set company_bios.email_accounts. Same shape as before — admin picks
// inboxes from any workspace and assigns them to a tenant.

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type EmailAccount = {
  email: string;
  daily_limit?: number;
  stat_warmup_score?: number;
  setup_pending?: boolean;
  warmup_status?: number;
};

async function fetchWorkspaceInboxes(apiKey: string): Promise<{ inboxes: any[]; error: string | null }> {
  if (!apiKey) return { inboxes: [], error: "missing api key" };
  const inboxes: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const path: string = cursor
      ? `/accounts?limit=100&starting_after=${encodeURIComponent(cursor)}`
      : "/accounts?limit=100";
    try {
      const res = await fetch(`${INSTANTLY_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        return { inboxes, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      for (const a of (data?.items ?? []) as EmailAccount[]) {
        if (typeof a?.email === "string") {
          inboxes.push({
            email: a.email,
            dailyLimit: a.daily_limit ?? 0,
            warmupScore: a.stat_warmup_score ?? 0,
            warmupStatus: a.warmup_status ?? 0,
            setupPending: !!a.setup_pending,
          });
        }
      }
      cursor = (data?.next_starting_after as string | null) ?? null;
      if (!cursor) break;
    } catch (e: any) {
      return { inboxes, error: e?.message ?? "fetch failed" };
    }
  }
  return { inboxes, error: null };
}

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const svc = getSupabaseService();

  const [{ data: workspaces, error: wsErr }, { data: bios, error: bErr }] = await Promise.all([
    svc.from("instantly_workspaces")
      .select("id, label, account_user_id, api_key, notes")
      .order("label"),
    svc.from("company_bios")
      .select("id, company_name, email_accounts, instantly_workspace_id, instantly_campaign_id")
      .order("company_name"),
  ]);
  if (wsErr) return NextResponse.json({ error: wsErr.message }, { status: 500 });
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  // Sections come from registered workspaces. We also surface an "env"
  // section (the legacy INSTANTLY_API_KEY env var) ONLY if no registered
  // workspace shares its account_user_id — otherwise we'd list duplicate
  // inboxes for the same Instantly Organization.
  const envKey = process.env.INSTANTLY_API_KEY ?? "";
  let envAccountUserId: string | null = null;
  if (envKey) {
    try {
      const decoded = Buffer.from(envKey, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      envAccountUserId = colon > 0 ? decoded.slice(0, colon) : null;
    } catch { /* ignore */ }
  }
  const envHasRegistered = (workspaces ?? []).some((w: any) => w.account_user_id && w.account_user_id === envAccountUserId);

  const sections: Array<{
    workspaceId: string | null;
    label: string;
    accountUserId: string | null;
    notes: string | null;
    isEnvFallback: boolean;
    inboxes: any[];
    error: string | null;
  }> = [];

  // Env fallback section first (if standalone)
  if (envKey && !envHasRegistered) {
    const envRes = await fetchWorkspaceInboxes(envKey);
    sections.push({
      workspaceId: null,
      label: "SWL — env fallback (unregistered)",
      accountUserId: envAccountUserId,
      notes: "INSTANTLY_API_KEY env var. Register this as a workspace to label/edit it.",
      isEnvFallback: true,
      inboxes: envRes.inboxes,
      error: envRes.error,
    });
  }

  // Registered workspaces — fetched in parallel.
  const wsResults = await Promise.all((workspaces ?? []).map(async (w: any) => {
    const r = await fetchWorkspaceInboxes(w.api_key);
    return {
      workspaceId: w.id as string,
      label: w.label as string,
      accountUserId: (w.account_user_id as string | null) ?? null,
      notes: (w.notes as string | null) ?? null,
      isEnvFallback: false,
      inboxes: r.inboxes,
      error: r.error,
    };
  }));
  sections.push(...wsResults);

  return NextResponse.json({
    sections,
    companies: (bios ?? []).map((b: any) => ({
      id: b.id,
      company_name: b.company_name,
      email_accounts: b.email_accounts ?? [],
      instantly_workspace_id: b.instantly_workspace_id ?? null,
      instantly_campaign_id: b.instantly_campaign_id ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const body = await req.json();
  const companyBioId = typeof body?.companyBioId === "string" ? body.companyBioId : null;
  if (!companyBioId) return NextResponse.json({ error: "Missing companyBioId" }, { status: 400 });

  const updatePayload: Record<string, unknown> = {};
  if (Array.isArray(body?.emailAccounts)) {
    updatePayload.email_accounts = body.emailAccounts;
  }
  if (typeof body?.instantlyWorkspaceId === "string" || body?.instantlyWorkspaceId === null) {
    updatePayload.instantly_workspace_id = body.instantlyWorkspaceId || null;
  }
  if (typeof body?.instantlyCampaignId === "string" || body?.instantlyCampaignId === null) {
    updatePayload.instantly_campaign_id = body.instantlyCampaignId || null;
  }
  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { error } = await svc.from("company_bios").update(updatePayload).eq("id", companyBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
