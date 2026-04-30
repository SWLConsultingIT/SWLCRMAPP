import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = [
  "/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback",
  "/api/auth", "/api/aircall/webhook", "/api/unipile/webhook",
  // Cron endpoints authenticate via CRON_SECRET inside the route handler,
  // so they must skip the Supabase session redirect in this middleware.
  "/api/cron",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  const isStatic = pathname.startsWith("/_next") || pathname.startsWith("/favicon");

  // Propagate pathname to server components so the root layout can skip
  // tenant-specific SSR (e.g. brand color) on public routes.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  if (isStatic || isPublic) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // `getUser()` can throw `AuthApiError: Invalid Refresh Token` when the
  // refresh token in the cookie has expired or was invalidated server-side
  // (e.g. after a Supabase project key rotation, manual session revocation,
  // or simply leaving the tab open past the refresh window). Treat any auth
  // error as "no user" + clear the stale Supabase cookies so the next request
  // doesn't keep retrying with the same bad token.
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (!user) {
    const redirectRes = NextResponse.redirect(new URL("/login", req.url));
    // Mirror any Set-Cookie headers Supabase wrote on `response` (e.g. cleared
    // session cookies) onto the redirect, so the client actually sheds them.
    for (const c of response.cookies.getAll()) {
      redirectRes.cookies.set(c.name, c.value, c);
    }
    // Belt-and-braces: explicitly clear common Supabase auth cookies in case
    // the SDK didn't (it doesn't always when the refresh token is malformed).
    for (const name of req.cookies.getAll().map(c => c.name)) {
      if (name.startsWith("sb-") && (name.endsWith("-auth-token") || name.includes("auth-token"))) {
        redirectRes.cookies.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" });
      }
    }
    return redirectRes;
  }

  // Heartbeat — update user_profiles.last_seen_at at most once per 60s. We
  // throttle via a cookie so the proxy only fires the UPDATE on the first
  // request of each minute, not on every navigation. The cookie holds the
  // last write time; if it's missing or stale we write and refresh it.
  const SEEN_COOKIE = "swl-last-seen-ping";
  const lastPing = req.cookies.get(SEEN_COOKIE)?.value;
  const lastPingMs = lastPing ? Number(lastPing) : 0;
  const HEARTBEAT_MS = 60 * 1000;
  if (!lastPingMs || Date.now() - lastPingMs > HEARTBEAT_MS) {
    // Fire and forget — don't block the response on the DB round-trip.
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${user.id}`, {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    }).catch(() => {});
    response.cookies.set(SEEN_COOKIE, String(Date.now()), {
      path: "/",
      maxAge: 60 * 60 * 24, // 1d — expires far enough that we always re-ping
      sameSite: "lax",
      httpOnly: true,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
