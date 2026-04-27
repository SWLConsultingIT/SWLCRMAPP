import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Surfaces the request pathname as an x-pathname header so the root layout
// can decide whether to emit the tenant brand <style>. Without this the layout
// can't tell login/signup from authenticated routes and ends up painting the
// last tenant's color on the public login screen — the bug Graeme saw.
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif)).*)"],
};
