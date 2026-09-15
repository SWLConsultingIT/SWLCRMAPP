// Lead Miner (/icp) — icp_profiles INSERT, relocated from the direct browser
// write in app/icp/page.tsx so the View-As read-only block (proxy.ts) covers it
// server-side. Uses the RLS server client (real user JWT), so the SAME
// icp_profiles tenant/permission policies apply as when the browser wrote
// directly — a real seller keeps exactly the access they had. company_bio_id
// and the creator stamp are derived server-side and never trusted from the body.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope } from "@/shared/auth/scope";
import { pickEditable } from "@/shared/icp/editable-fields";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const form = pickEditable(body);
  if (!form.profile_name) return NextResponse.json({ error: "Missing profile_name" }, { status: 400 });

  const sb = await getSupabaseServer();
  // Creator stamp — same as the old browser path (auth.getUser()), now server-side.
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("icp_profiles")
    // company_bio_id pinned to the caller's tenant; status defaults to pending review.
    .insert({ ...form, company_bio_id: scope.companyBioId, status: "pending", created_by: user?.id ?? null, created_by_email: user?.email ?? null })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
}
