// Per-ICP lead CSV export for Lead Miner. Returns ALL leads of one ICP as a
// clean CSV whose columns adapt to that ICP automatically: a fixed base set
// (person + company + status) followed by the UNION of the ICP's enrichment
// keys (cleaned via normalizeEnrichment). Because the enrichment columns are
// derived from the leads at export time, a new import with different columns
// "just works" — nothing to configure.
//
// Enrichment lives inside encrypted_payload for client-source leads, so this
// MUST run server-side and decrypt (hydrateClientLeads) — the old client-only
// ExportLeadsCSVButton could never see it.

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabaseServer } from "@/lib/supabase-server";
import { hydrateClientLeads } from "@/lib/leads-crypto";
import { requireUser } from "@/lib/require-scope";
import { normalizeEnrichment, prettyLabel } from "@/lib/enrichment-export";

export const maxDuration = 60;

const LEAD_COLUMNS =
  "id, source, encrypted_payload, company_bio_id, enrichment, icp_profile_id, " +
  "primary_first_name, primary_last_name, company_name, primary_title_role, " +
  "primary_work_email, primary_phone, primary_linkedin_url, company_industry, " +
  "company_city, company_country, status, lead_score, is_priority, current_channel, created_at";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return g.response;

  const { id: icpId } = await params;
  if (!icpId) return NextResponse.json({ error: "missing icp id" }, { status: 400 });

  const supabase = await getSupabaseServer();

  // ICP name → filename. RLS scopes this to the caller's tenant.
  const { data: icp } = await supabase
    .from("icp_profiles").select("profile_name").eq("id", icpId).single();
  const icpName = (icp?.profile_name as string | undefined) ?? "leads";

  // Fetch every lead of this ICP (paginated — a single response caps at ~1000).
  const raw: Record<string, unknown>[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await supabase
      .from("leads").select(LEAD_COLUMNS)
      .eq("icp_profile_id", icpId)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    raw.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  const leads = await hydrateClientLeads(raw) as Record<string, any>[];

  // Campaign name/status per lead (best of active > paused > completed).
  const campByLead = new Map<string, { name: string; status: string }>();
  const leadIds = leads.map(l => l.id as string);
  for (let i = 0; i < leadIds.length; i += 300) {
    const { data: camps } = await supabase
      .from("campaigns").select("lead_id, name, status")
      .in("lead_id", leadIds.slice(i, i + 300))
      .in("status", ["active", "paused", "completed"]);
    const rank = (s: string) => (s === "active" ? 3 : s === "paused" ? 2 : s === "completed" ? 1 : 0);
    for (const c of camps ?? []) {
      const lid = (c as any).lead_id as string | null;
      if (!lid) continue;
      const cur = campByLead.get(lid);
      if (!cur || rank((c as any).status) > rank(cur.status)) {
        campByLead.set(lid, { name: (c as any).name, status: (c as any).status });
      }
    }
  }

  // Fixed base columns (header → value extractor).
  const base: Array<[string, (l: Record<string, any>) => unknown]> = [
    ["First Name", l => l.primary_first_name],
    ["Last Name", l => l.primary_last_name],
    ["Company", l => l.company_name],
    ["Role", l => l.primary_title_role],
    ["Email", l => l.primary_work_email],
    ["Phone", l => l.primary_phone],
    ["LinkedIn", l => l.primary_linkedin_url],
    ["Industry", l => l.company_industry],
    ["City", l => l.company_city],
    ["Country", l => l.company_country],
    ["Status", l => l.status],
    ["Score", l => l.lead_score],
    ["Priority", l => (l.is_priority ? "Yes" : "")],
    ["Channel", l => l.current_channel],
    ["Campaign", l => campByLead.get(l.id)?.name ?? ""],
    ["Campaign Status", l => campByLead.get(l.id)?.status ?? ""],
    ["Created", l => (l.created_at ? String(l.created_at).slice(0, 10) : "")],
  ];

  // Dynamic enrichment columns = union of this ICP's cleaned enrichment keys.
  const cleaned = leads.map(l => normalizeEnrichment(l.enrichment as Record<string, unknown>));
  const keySet = new Set<string>();
  for (const e of cleaned) for (const k of Object.keys(e)) keySet.add(k);
  const enrKeys = [...keySet].sort((a, b) => a.localeCompare(b));

  // Build headers, keeping them unique (two keys could prettify to the same label).
  const usedHeaders = new Set(base.map(b => b[0]));
  const enrHeaders: string[] = enrKeys.map(k => {
    let h = prettyLabel(k) || k;
    if (usedHeaders.has(h)) h = `${h} (${k})`;
    usedHeaders.add(h);
    return h;
  });

  const fields = [...base.map(b => b[0]), ...enrHeaders];
  const rows = leads.map((l, i) => {
    const row = base.map(([, fn]) => str(fn(l)));
    const e = cleaned[i];
    for (const k of enrKeys) row.push(str(e[k]));
    return row;
  });

  const csv = Papa.unparse({ fields, data: rows });
  const safeName = icpName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "leads";

  // BOM so Excel opens UTF-8 (accents) correctly.
  return new NextResponse("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ICP-${safeName}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
