import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";

const THEME_COOKIE = "swl-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Sync the swl-theme cookie to whatever the DB says is the current user's
// theme. The server-side layout reads this cookie on the first byte to emit
// `<html data-theme="dark">` flash-free. Setting it from the server (instead
// of the client) keeps it authoritative and survives tenant impersonation
// toggles, hard reloads, and multi-tab usage.
function setThemeCookie(res: NextResponse, theme: "light" | "dark") {
  res.cookies.set(THEME_COOKIE, theme, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  // Unauthenticated → return an explicit signal instead of a default theme.
  // Returning {theme:"light"} caused pullThemeFromDb on /login to force the
  // dark cookie back to light, then login → home flashed white before the
  // post-auth refetch could restore dark.
  if (!user) return NextResponse.json({ authenticated: false });

  const svc = getSupabaseService();
  const { data: profile } = await svc
    .from("user_profiles")
    .select("theme, locale")
    .eq("user_id", user.id)
    .maybeSingle();

  const theme = profile?.theme === "dark" ? "dark" : "light";
  const locale = profile?.locale ?? "en";

  const res = NextResponse.json({
    userId: user.id,
    theme,
    locale,
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
  setThemeCookie(res, theme);
  return res;
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

  const res = NextResponse.json({ ok: true, ...update });
  if (update.theme === "light" || update.theme === "dark") {
    setThemeCookie(res, update.theme);
  }
  return res;
}
