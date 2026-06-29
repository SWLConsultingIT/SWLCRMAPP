import { NextRequest, NextResponse } from "next/server";
import { getUserScope } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, encryptWithResolvedKey } from "@/lib/leads-crypto";

// Cross-sell: turn a scraped nearby company into a real Everest lead. Demo-only.
const EVEREST_BIO = "4ab610c8-e852-4b37-97d7-c41ba19b0d0e";
const EVEREST_ICP = "da1b0fc7-ad76-40e2-9646-348cd7f82d28";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, address, phone, web, industry, fromCompany } = body as {
    name?: string; address?: string; phone?: string; web?: string; industry?: string; fromCompany?: string;
  };
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const svc = getSupabaseService();
  const { data: anchor } = await svc.from("leads").select("company_bio_id").eq("id", id).maybeSingle();
  if (!anchor || anchor.company_bio_id !== EVEREST_BIO) {
    return NextResponse.json({ error: "demo-only (Gruppo Everest)" }, { status: 403 });
  }

  // Idempotency: skip if we already created this cross-sell lead from this anchor.
  const { data: existing } = await svc.from("leads").select("id")
    .eq("company_bio_id", EVEREST_BIO)
    .eq("enrichment->>cross_sell_name", name)
    .maybeSingle();
  if (existing) return NextResponse.json({ leadId: existing.id, alreadyExists: true });

  const payload: Record<string, unknown> = {
    company_name: name,
    company_website: web || null,
    company_phone: phone || null,
    company_industry: industry || null,
    company_address_1: address || null,
    company_country: "Italy",
    primary_phone: phone || null,
    primary_title_role: "Owner / Manager",
    primary_seniority: "owner",
    enrichment: {
      source: "cross-sell-nearby",
      cross_sell_name: name,
      cross_sell_from: fromCompany || null,
      cross_sell_anchor_lead_id: id,
    },
  };

  const { key } = await resolveTenantKey(EVEREST_BIO);
  const { ciphertext, version } = encryptWithResolvedKey(payload, key);

  const { data: created, error } = await svc.from("leads").insert({
    company_bio_id: EVEREST_BIO,
    icp_profile_id: EVEREST_ICP,
    status: "new",
    source: "client",
    source_tool: "cross-sell-nearby",
    source_universe: "client",
    allow_linkedin: true,
    allow_email: true,
    allow_call: !!phone,
    encrypted_payload: "\\x" + ciphertext.toString("hex"),
    encryption_version: version,
    sync_status: "pending",
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leadId: created.id });
}
