import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = [
  "/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback",
  "/api/auth", "/api/aircall/webhook", "/api/unipile/webhook",
  // Transcribe is fired server-to-server from the webhook (no cookie); it
  // already self-protects by being idempotent and no-op on already-transcribed
  // calls. The recording_url in the DB is the only thing it can act on.
  "/api/aircall/transcribe",
  // Cron endpoints authenticate via CRON_SECRET inside the route handler,
  // so they must skip the Supabase session redirect in this middleware.
  "/api/cron",
  // Public uptime probe consumed by external monitors (UptimeRobot etc).
  // Returns 200/503 only; no data exposure.
  "/api/health",
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

  // `getUser()` can fail two very different ways and we MUST distinguish them:
  //   (A) Auth rejection — bad/expired refresh token, project key rotation,
  //       session revoked. Status 401. Correct response: clear cookies and
  //       redirect to /login.
  //   (B) Infrastructure error — Supabase timing out (DB saturated), network
  //       blip, 5xx from auth service. Status >= 500 or thrown. Correct
  //       response: KEEP cookies (the session is still valid!) and surface a
  //       503 so the user retries without losing their session.
  // Pre-2026-05-14 we conflated these: any failure → clear cookies → redirect
  // to /login → login also failed (same Supabase saturation) → permanent
  // lockout. That's how today's incident escalated.
  let user: { id: string } | null = null;
  let infraError = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      const status = (error as { status?: number }).status;
      // Treat anything that isn't a clean 4xx as an infra problem.
      if (!status || status >= 500) infraError = true;
    }
    user = data.user;
  } catch {
    // Thrown errors are network/timeout, never auth-rejection.
    infraError = true;
  }

  if (!user) {
    if (infraError) {
      // Don't redirect or clear cookies — the user's session is probably still
      // valid, we just couldn't verify it. Auto-refresh after 3s so the user
      // doesn't have to do anything.
      return new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8">
         <meta http-equiv="refresh" content="3">
         <title>Service degraded</title>
         <style>body{margin:0;background:#04070d;color:#d9dee2;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.box{max-width:440px;padding:32px}h1{color:#b79832;font-size:18px;margin:0 0 8px}p{color:rgba(217,222,226,0.6);font-size:14px;margin:0 0 16px;line-height:1.5}.spinner{display:inline-block;width:18px;height:18px;border:2px solid rgba(183,152,50,0.2);border-top-color:#b79832;border-radius:50%;animation:s 0.8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
         <body><div class="box"><h1>Service temporarily slow</h1><p>Auth is taking longer than usual. Retrying automatically…</p><div class="spinner"></div></div></body></html>`,
        { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3" } }
      );
    }
    // Genuine auth rejection — clear cookies and bounce to /login.
    const redirectRes = NextResponse.redirect(new URL("/login", req.url));
    for (const c of response.cookies.getAll()) {
      redirectRes.cookies.set(c.name, c.value, c);
    }
    for (const name of req.cookies.getAll().map(c => c.name)) {
      if (name.startsWith("sb-") && (name.endsWith("-auth-token") || name.includes("auth-token"))) {
        redirectRes.cookies.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" });
      }
    }
    return redirectRes;
  }

  // Heartbeat — update user_profiles.last_seen_at at most once per 5 min. We
  // throttle via a cookie so the proxy only fires the UPDATE on the first
  // request of each window, not on every navigation. last_seen_at is only
  // consumed by admin UIs (ActivityWidget, /api/team) where 5-min granularity
  // is plenty — a tighter heartbeat just burns disk IO on tiny instances.
  const SEEN_COOKIE = "swl-last-seen-ping";
  const lastPing = req.cookies.get(SEEN_COOKIE)?.value;
  const lastPingMs = lastPing ? Number(lastPing) : 0;
  const HEARTBEAT_MS = 5 * 60 * 1000;
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
