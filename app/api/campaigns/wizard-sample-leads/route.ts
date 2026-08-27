// POST /api/campaigns/wizard-sample-leads
//
// Feeds two things in wizard Step 3 (Messages) that used to be guesswork:
//
//   1. `leads` — up to 3 real leads from this flow's selection, with the
//      columns renderPlaceholders reads. The Messages step renders the
//      template against these so the author sees the message as the lead
//      will receive it, instead of a body full of {{tokens}}. Three raw
//      placeholder incidents (PE Spain {{fund_name}}, Craig Wilson
//      [First Name], the 2026-08-15 single-brace auto-reply) all shipped
//      because nobody could see the rendered text before approving.
//
//   2. `coverage` — how many leads in the selection actually have each
//      field loaded. A placeholder is only safe if the data is there;
//      {{company_city}} on a selection where 40% have no city leaves a
//      hole mid-sentence. The wizard shows this per token.
//
// Client-source leads keep their PII inside encrypted_payload, so plain
// columns read null. The sample prefers plaintext rows and decrypts only
// when it has to — coverage is reported over the plain columns with the
// encrypted count returned alongside, never extrapolated, so the UI can
// say what was actually measured.
//
// Body: { leadIds?: string[], icpProfileId?: string }
//   leadIds wins when present (a partial selection); otherwise the whole ICP.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";
import { LEAD_PLACEHOLDER_COLUMNS } from "@/lib/placeholders";

export const maxDuration = 30;

/** The columns we report coverage for, in the order the wizard lists them. */
const COVERAGE_COLUMNS = [
  "primary_first_name",
  "company_name",
  "primary_title_role",
  "company_city",
  "company_industry",
  "company_country",
  "company_website",
] as const;

type SampleLead = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
  primary_title_role: string | null;
  company_city: string | null;
  company_industry: string | null;
  company_country: string | null;
  company_website: string | null;
};

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[]; icpProfileId?: string };
  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  const icpProfileId = typeof body.icpProfileId === "string" ? body.icpProfileId : null;
  if (leadIds.length === 0 && !icpProfileId) {
    return NextResponse.json({ leads: [], coverage: {}, total: 0, encrypted: 0 });
  }

  const svc = getSupabaseService();

  // An id filter travels in the QUERY STRING (`id=in.(uuid,uuid,…)`), so a
  // whole-ICP selection of 1 166 leads would be ~44 KB of URL and Supabase's
  // edge rejects it. Everything below therefore runs per chunk of ids and the
  // counts are summed; with no ids we filter by ICP and run once.
  const ID_CHUNK = 300;
  const idChunks: (string[] | null)[] = leadIds.length > 0
    ? Array.from({ length: Math.ceil(leadIds.length / ID_CHUNK) }, (_, i) =>
        leadIds.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK))
    : [null];

  // Every query goes through this so the selection filter and the tenant
  // guard can never drift apart between the counts and the sample.
  function scoped(select: string, chunk: string[] | null, opts?: { count: "exact"; head: true }) {
    let q = opts
      ? svc.from("leads").select(select, opts)
      : svc.from("leads").select(select);
    if (chunk) q = q.in("id", chunk);
    else if (icpProfileId) q = q.eq("icp_profile_id", icpProfileId);
    if (scope.isScoped && scope.companyBioId) q = q.eq("company_bio_id", scope.companyBioId);
    return q;
  }

  // ── Coverage: exact head-only COUNTs, so no rows travel and the PostgREST
  // 1000-row cap can't truncate anything.
  async function countAcross(build: (chunk: string[] | null) => PromiseLike<{ count: number | null; error: unknown }>) {
    const parts = await Promise.all(idChunks.map(c => build(c)));
    const failed = parts.find(p => p.error);
    if (failed) return { count: 0, error: failed.error };
    return { count: parts.reduce((a, p) => a + (p.count ?? 0), 0), error: null };
  }

  const [totalRes, encryptedRes, ...columnCounts] = await Promise.all([
    countAcross(c => scoped("id", c, { count: "exact", head: true })),
    countAcross(c => scoped("id", c, { count: "exact", head: true }).eq("source", "client")),
    ...COVERAGE_COLUMNS.map(col =>
      countAcross(c => scoped("id", c, { count: "exact", head: true }).not(col, "is", null).neq(col, "")),
    ),
  ]);

  if (totalRes.error) {
    return NextResponse.json({ error: "coverage count failed" }, { status: 500 });
  }

  const coverage: Record<string, number> = {};
  COVERAGE_COLUMNS.forEach((col, i) => {
    coverage[col] = columnCounts[i]?.count ?? 0;
  });

  // ── Sample: prefer plaintext rows so the common case needs no decrypt.
  // Three leads is all the preview needs, so the first chunk is enough.
  const firstChunk = idChunks[0];
  const { data: plain } = await scoped(`id, ${LEAD_PLACEHOLDER_COLUMNS}`, firstChunk)
    .neq("source", "client")
    .not("primary_first_name", "is", null)
    .limit(3);

  let leads = (plain ?? []) as unknown as SampleLead[];

  // Nothing readable in the clear (a fully client-uploaded tenant like De
  // Vera or Miranda Bosch) — pull encrypted rows and decrypt just these.
  if (leads.length === 0) {
    const { data: enc } = await scoped("id, company_bio_id, encrypted_payload", firstChunk)
      .eq("source", "client")
      .not("encrypted_payload", "is", null)
      .limit(3);
    const rows = (enc ?? []) as unknown as Array<{ id: string; company_bio_id: string; encrypted_payload: unknown }>;
    const decrypted: SampleLead[] = [];
    for (const row of rows) {
      try {
        const { key } = await resolveTenantKey(row.company_bio_id);
        const payload = decryptWithResolvedKey(bufferFromSupabaseBytea(row.encrypted_payload), key);
        const pick = (k: string) => {
          const v = payload[k];
          return typeof v === "string" && v.trim() ? v : null;
        };
        decrypted.push({
          id: row.id,
          primary_first_name: pick("primary_first_name"),
          primary_last_name: pick("primary_last_name"),
          company_name: pick("company_name"),
          primary_title_role: pick("primary_title_role"),
          company_city: pick("company_city"),
          company_industry: pick("company_industry"),
          company_country: pick("company_country"),
          company_website: pick("company_website"),
        });
      } catch (err) {
        // A lead we can't decrypt just doesn't make it into the preview.
        console.error("[wizard-sample-leads] decrypt failed for lead", row.id, err);
      }
    }
    leads = decrypted;
  }

  return NextResponse.json({
    leads,
    coverage,
    total: totalRes.count ?? 0,
    encrypted: encryptedRes.count ?? 0,
  });
}
