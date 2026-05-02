import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Tenant-scoped Instantly account assignment.
//
// company_bios.email_accounts is a string[] of email addresses owned by that
// tenant. The dispatcher's pool rotation must only pick from a tenant's own
// list — otherwise a campaign for tenant A could rotate through an Instantly
// inbox owned by tenant B (cross-tenant leak in the from-address).
//
// GET  → returns every Instantly account in the org with its owner status
//        (mine / available / claimed-by-other) so the UI can render a picker.
// PATCH → replaces the current user's tenant email_accounts with the supplied
//         list. Validates that no email in the new list is currently owned by
//         a DIFFERENT tenant — only unowned emails or already-mine ones may
//         be claimed.

const INSTANTLY_KEY = process.env.INSTANTLY_API_KEY ?? "";
const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type InstantlyAccount = {
  email: string;
  daily_limit?: number;
  stat_warmup_score?: number;
  warmup_status?: number;
  setup_pending?: boolean;
  status?: number;
};

async function fetchInstantlyAccounts(): Promise<InstantlyAccount[]> {
  if (!INSTANTLY_KEY) return [];
  const accounts: InstantlyAccount[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const path: string = cursor
      ? `/accounts?limit=100&starting_after=${encodeURIComponent(cursor)}`
      : "/accounts?limit=100";
    const res: Response = await fetch(`${INSTANTLY_BASE}${path}`, {
      headers: { Authorization: `Bearer ${INSTANTLY_KEY}`, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) break;
    const data: { items?: InstantlyAccount[]; next_starting_after?: string | null } = await res.json();
    for (const a of data?.items ?? []) {
      if (typeof a?.email === "string") accounts.push(a);
    }
    cursor = data?.next_starting_after ?? null;
    if (!cursor) break;
  }
  return accounts;
}

async function getCurrentBioId(): Promise<string | null> {
  const sb = await getSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("company_bio_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return profile?.company_bio_id ?? null;
}

export async function GET() {
  const myBioId = await getCurrentBioId();
  if (!myBioId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = getSupabaseService();
  const [accounts, { data: bios }] = await Promise.all([
    fetchInstantlyAccounts(),
    svc.from("company_bios").select("id, company_name, email_accounts"),
  ]);

  // Build email → owning-bio index. Empty/null email_accounts mean unowned.
  const ownerByEmail: Record<string, { id: string; name: string | null }> = {};
  for (const b of bios ?? []) {
    const list = ((b as any).email_accounts as string[] | null) ?? [];
    for (const e of list) {
      ownerByEmail[String(e).toLowerCase()] = { id: (b as any).id, name: (b as any).company_name };
    }
  }

  const myEmails: string[] = [];
  const enriched = accounts.map(a => {
    const key = a.email.toLowerCase();
    const owner = ownerByEmail[key];
    const isMine = owner?.id === myBioId;
    if (isMine) myEmails.push(a.email);
    return {
      email: a.email,
      dailyLimit: a.daily_limit ?? 0,
      warmupScore: a.stat_warmup_score ?? 0,
      warmupStatus: a.warmup_status ?? 0,
      setupPending: !!a.setup_pending,
      isMine,
      claimedByOther: !!owner && !isMine,
      claimedByName: !isMine && owner ? owner.name : null,
    };
  });

  return NextResponse.json({ myEmails, accounts: enriched });
}

export async function PATCH(req: NextRequest) {
  const scope = await getUserScope();
  // Only SWL admins claim inboxes on behalf of tenants today. Clients viewing
  // their tenant page can read the pool (GET) but not mutate it.
  if (scope.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const myBioId = await getCurrentBioId();
  if (!myBioId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const incoming = Array.isArray(body?.emails) ? body.emails : null;
  if (!incoming) return NextResponse.json({ error: "emails must be an array" }, { status: 400 });

  // Normalize, dedupe, basic shape check.
  const normalized: string[] = Array.from(new Set(
    (incoming as unknown[])
      .filter((e): e is string => typeof e === "string")
      .map(e => e.trim())
      .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  ));

  const svc = getSupabaseService();
  const { data: bios } = await svc.from("company_bios").select("id, company_name, email_accounts");

  // Reject any email that's currently owned by a different tenant. Already-mine
  // ones are fine (re-saving the same list is a no-op).
  const conflicts: string[] = [];
  for (const e of normalized) {
    const eLower = e.toLowerCase();
    for (const b of bios ?? []) {
      if ((b as any).id === myBioId) continue;
      const list = (((b as any).email_accounts as string[] | null) ?? []).map(x => String(x).toLowerCase());
      if (list.includes(eLower)) {
        conflicts.push(`${e} (owned by ${(b as any).company_name ?? "another tenant"})`);
      }
    }
  }
  if (conflicts.length > 0) {
    return NextResponse.json({ error: "Some emails belong to other tenants", conflicts }, { status: 409 });
  }

  const { error } = await svc
    .from("company_bios")
    .update({ email_accounts: normalized })
    .eq("id", myBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, emails: normalized });
}
