import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminApi } from "@/lib/auth-admin";
import { NextRequest, NextResponse } from "next/server";

const INSTANTLY_KEY = process.env.INSTANTLY_API_KEY!;

type EmailAccount = { email: string; daily_limit?: number; stat_warmup_score?: number; setup_pending?: boolean };

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseService();

  // Fetch all Instantly pool emails + all companies with their assignments
  const [instantlyRes, { data: bios }] = await Promise.all([
    fetch("https://api.instantly.ai/api/v2/accounts?limit=100", {
      headers: { Authorization: `Bearer ${INSTANTLY_KEY}` },
      cache: "no-store",
    }),
    supabase.from("company_bios").select("id, company_name, email_accounts").order("company_name"),
  ]);

  let allEmails: { email: string; dailyLimit: number; warmupScore: number; setupPending: boolean }[] = [];
  if (instantlyRes.ok) {
    const data = await instantlyRes.json();
    allEmails = (data.items || []).map((a: EmailAccount) => ({
      email: a.email,
      dailyLimit: a.daily_limit ?? 0,
      warmupScore: a.stat_warmup_score ?? 0,
      setupPending: !!a.setup_pending,
    }));
  }

  return NextResponse.json({ emails: allEmails, companies: bios ?? [] });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;
  const { companyBioId, emailAccounts } = await req.json();
  if (!companyBioId) return NextResponse.json({ error: "Missing companyBioId" }, { status: 400 });
  const supabase = getSupabaseService();
  const { error } = await supabase
    .from("company_bios")
    .update({ email_accounts: Array.isArray(emailAccounts) ? emailAccounts : null })
    .eq("id", companyBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
