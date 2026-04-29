import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ theme: "light", locale: "en" });

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("theme, locale")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    userId: user.id,
    theme: profile?.theme ?? "light",
    locale: profile?.locale ?? "en",
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const update: Record<string, any> = {};
  if (body.theme === "light" || body.theme === "dark") update.theme = body.theme;
  if (body.locale === "en" || body.locale === "es") update.locale = body.locale;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const svc = getSupabaseService();
  const { error } = await svc
    .from("user_profiles")
    .update(update)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...update });
}
