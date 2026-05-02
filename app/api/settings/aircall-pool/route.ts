import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

// Tenant-scoped Aircall number assignment.
//
// company_bios.aircall_number_ids is a number[] of Aircall number IDs owned
// by the tenant. The /accounts UI filters the Aircall card by this list, so
// each tenant only sees their own numbers (no cross-tenant leak).

const AIRCALL_API_ID = process.env.AIRCALL_API_ID ?? "";
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN ?? "";
const AIRCALL_AUTH = Buffer.from(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`).toString("base64");

type AircallNumber = {
  id: number;
  name?: string | null;
  digits?: string | null;
  country?: string | null;
  availability_status?: string | null;
  is_active?: boolean | null;
};

async function fetchAircallNumbers(): Promise<AircallNumber[]> {
  if (!AIRCALL_API_ID || !AIRCALL_API_TOKEN) return [];
  const res = await fetch("https://api.aircall.io/v1/numbers", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data: { numbers?: AircallNumber[] } = await res.json();
  return data.numbers ?? [];
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
  const [numbers, { data: bios }] = await Promise.all([
    fetchAircallNumbers(),
    svc.from("company_bios").select("id, company_name, aircall_number_ids"),
  ]);

  const ownerByNumber: Record<number, { id: string; name: string | null }> = {};
  for (const b of bios ?? []) {
    const list = (((b as any).aircall_number_ids as number[] | null) ?? []).map(Number);
    for (const id of list) {
      ownerByNumber[id] = { id: (b as any).id, name: (b as any).company_name };
    }
  }

  const myIds: number[] = [];
  const enriched = numbers.map(n => {
    const owner = ownerByNumber[Number(n.id)];
    const isMine = owner?.id === myBioId;
    if (isMine) myIds.push(n.id);
    return {
      id: n.id,
      name: n.name ?? n.digits ?? `#${n.id}`,
      digits: n.digits ?? "",
      country: n.country ?? "—",
      availability: n.availability_status ?? "unknown",
      isActive: n.is_active !== false,
      isMine,
      claimedByOther: !!owner && !isMine,
      claimedByName: !isMine && owner ? owner.name : null,
    };
  });

  return NextResponse.json({ myIds, numbers: enriched });
}

export async function PATCH(req: NextRequest) {
  const myBioId = await getCurrentBioId();
  if (!myBioId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const incoming = Array.isArray(body?.numberIds) ? body.numberIds : null;
  if (!incoming) return NextResponse.json({ error: "numberIds must be an array of numbers" }, { status: 400 });

  const normalized: number[] = Array.from(new Set(
    (incoming as unknown[])
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n > 0),
  ));

  const svc = getSupabaseService();
  const { data: bios } = await svc.from("company_bios").select("id, company_name, aircall_number_ids");

  const conflicts: string[] = [];
  for (const id of normalized) {
    for (const b of bios ?? []) {
      if ((b as any).id === myBioId) continue;
      const list = (((b as any).aircall_number_ids as number[] | null) ?? []).map(Number);
      if (list.includes(id)) {
        conflicts.push(`#${id} (owned by ${(b as any).company_name ?? "another tenant"})`);
      }
    }
  }
  if (conflicts.length > 0) {
    return NextResponse.json({ error: "Some numbers belong to other tenants", conflicts }, { status: 409 });
  }

  const { error } = await svc
    .from("company_bios")
    .update({ aircall_number_ids: normalized })
    .eq("id", myBioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, numberIds: normalized });
}
