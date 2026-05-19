import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.tier) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leadIds } = await req.json();
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  }

  const { error } = await supabase.from("leads").delete().in("id", leadIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
