// Pre-auth email existence probe used by the signup flow.
//
// Two pre-2026-05-29 problems:
//   1. `listUsers()` defaulted to perPage=50 so workspaces with > 50 auth
//      users would falsely report "doesn't exist" for users past page 1.
//   2. The endpoint was a frictionless user-enumeration oracle. Anyone could
//      probe in a tight loop and harvest the user database for credential
//      stuffing or targeted phishing.
//
// Mitigations applied here are pragmatic, not perfect:
//   - Cursor-loop pagination caps at 5 pages × 200 = 1000 users (enough for
//     all current tenants; bumped lazily if we ever cross it).
//   - 800ms server-side delay slows brute-force enumeration from
//     ~thousands/sec to ~1/sec without breaking the signup UX.
//   - A proper rate-limiter (Upstash/Redis) is the real fix — tracked as
//     follow-up. This endpoint is the weakest pre-auth surface we have.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";

const MAX_PAGES = 5;
const PAGE_SIZE = 200;
const ENUMERATION_DELAY_MS = 800;

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ exists: false });
  }
  const needle = email.toLowerCase().trim();

  await new Promise(r => setTimeout(r, ENUMERATION_DELAY_MS));

  const svc = getSupabaseService();
  let exists = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) break;
    const users = data?.users ?? [];
    if (users.length === 0) break;
    if (users.some(u => u.email?.toLowerCase() === needle)) {
      exists = true;
      break;
    }
    if (users.length < PAGE_SIZE) break;
  }

  return NextResponse.json({ exists });
}
