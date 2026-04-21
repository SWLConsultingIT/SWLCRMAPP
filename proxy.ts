import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  const isStatic = pathname.startsWith("/_next") || pathname.startsWith("/favicon");

  if (isStatic || isPublic) return NextResponse.next();

  const auth = req.cookies.get("crm_auth")?.value;
  if (!auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
