#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────
// Admin "View as Seller" — security regression tests.
//
// The feature is an EFFECTIVE VIEW SCOPE, never an identity mutation. Its one
// job is to NARROW what an admin sees to a single own-tenant seller — and it
// must NEVER widen access or cross a tenant. Every assertion here is a
// fail-closed guarantee:
//
//   · a real seller can't forge the cookie into an escalation (isAdmin=false)
//   · an admin can't be pushed across tenants (company_bio_id mismatch → null)
//   · missing tenant, missing login, inactive, unknown id → null (own scope)
//   · the seller picker only ever lists own-tenant, active, has-login sellers
//
// resolveViewAsSeller / listViewAsSellers are the single server-side chokepoint
// (scope.ts, /api/auth/me and /api/auth/view-as all route through them), so a
// null here means the admin keeps their real admin scope everywhere.
// ─────────────────────────────────────────────────────────────────────────

import { resolveViewAsSeller, listViewAsSellers } from "../shared/auth/view-as.ts";
import { leadInScope, scopeRowsToAssigned } from "../shared/auth/seller-scope.ts";
import { isViewAsActive, setViewAsActive } from "../shared/auth/view-as-flag.ts";
import { campaignWriteAuthz, getVisibleCampaign, type CampaignRow } from "../shared/auth/campaign-access.ts";

let pass = 0, fail = 0; const fails: string[] = [];
const check = (l: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${l}`); } else { fail++; fails.push(`${l} ${d}`); console.log(`  ✗ ${l} ${d}`); }
};
const eq = (l: string, a: unknown, b: unknown) => check(l, Object.is(a, b), `— got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ── the world ────────────────────────────────────────────────────────── */
const TENANT_A = "bio-A", TENANT_B = "bio-B";

type Seller = { id: string; name: string | null; user_id: string | null; company_bio_id: string | null; active: boolean | null };

const SELLERS: Seller[] = [
  { id: "s-isaac",   name: "Isaac",   user_id: "u-isaac",  company_bio_id: TENANT_A, active: true },
  { id: "s-lucho",   name: "Lucho",   user_id: "u-lucho",  company_bio_id: TENANT_A, active: true },
  { id: "s-inactive",name: "Ghost",   user_id: "u-ghost",  company_bio_id: TENANT_A, active: false },
  { id: "s-nologin", name: "NoLogin", user_id: null,       company_bio_id: TENANT_A, active: true },
  { id: "s-foreign", name: "Foreign", user_id: "u-foreign",company_bio_id: TENANT_B, active: true },
];

// Minimal Supabase-shaped stub: only the chains view-as.ts actually uses.
// The stub NEVER filters by tenant on the server — it returns the row by id —
// so the tenant-isolation check lives entirely in the code under test, which
// is exactly what we want to exercise.
function fakeSvc(rows: Seller[]) {
  function builder(initial: Seller[]) {
    let data = initial.slice();
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(col: keyof Seller, val: unknown) { data = data.filter(r => r[col] === val); return q; },
      not(col: keyof Seller, op: string, val: unknown) {
        if (op === "is" && val === null) data = data.filter(r => r[col] != null);
        return q;
      },
      order() { return q; },
      maybeSingle() { return Promise.resolve({ data: data[0] ?? null }); },
      then(resolve: (v: { data: Seller[] }) => unknown) { return Promise.resolve({ data }).then(resolve); },
    };
    return q;
  }
  return { from(table: string) { return builder(table === "sellers" ? rows : []); } } as never;
}

const svc = fakeSvc(SELLERS);

/* ── 1 · a real seller forging the cookie gets NOTHING ──────────────────── */
console.log("\n1. real seller forges the cookie → no override (own scope only)");
eq("  isAdmin=false → null", await resolveViewAsSeller(svc, "s-isaac", false, TENANT_A), null);

/* ── 2 · admin + valid own-tenant seller resolves ───────────────────────── */
console.log("\n2. admin previews an own-tenant seller → resolves");
const isaac = await resolveViewAsSeller(svc, "s-isaac", true, TENANT_A);
check("  resolves to Isaac", isaac !== null);
eq("  sellerId is the sellers.id", isaac?.sellerId, "s-isaac");
eq("  sellerUserId is the auth login id", isaac?.sellerUserId, "u-isaac");
eq("  name carried through", isaac?.sellerName, "Isaac");

/* ── 3 · TENANT ISOLATION — never cross a tenant ────────────────────────── */
console.log("\n3. admin of tenant A targets a tenant B seller → fail closed");
eq("  cross-tenant → null", await resolveViewAsSeller(svc, "s-foreign", true, TENANT_A), null);
check("  same seller IS resolvable by its own tenant's admin (proof the id is valid)",
  (await resolveViewAsSeller(svc, "s-foreign", true, TENANT_B)) !== null);

/* ── 4 · degenerate / hostile inputs → null ─────────────────────────────── */
console.log("\n4. missing / invalid inputs all fail closed");
eq("  no cookie → null", await resolveViewAsSeller(svc, null, true, TENANT_A), null);
eq("  empty cookie → null", await resolveViewAsSeller(svc, "", true, TENANT_A), null);
eq("  admin without a tenant → null", await resolveViewAsSeller(svc, "s-isaac", true, null), null);
eq("  unknown seller id → null", await resolveViewAsSeller(svc, "s-does-not-exist", true, TENANT_A), null);
eq("  inactive seller → null", await resolveViewAsSeller(svc, "s-inactive", true, TENANT_A), null);
eq("  seller with no login (user_id null) → null", await resolveViewAsSeller(svc, "s-nologin", true, TENANT_A), null);

/* ── 5 · the picker lists only safe, own-tenant options ─────────────────── */
console.log("\n5. listViewAsSellers → own-tenant, active, has-login only");
const optsA = await listViewAsSellers(svc, TENANT_A);
eq("  tenant A sees exactly 2 (Isaac, Lucho)", optsA.length, 2);
check("  inactive excluded", !optsA.some(o => o.sellerId === "s-inactive"));
check("  no-login excluded", !optsA.some(o => o.sellerId === "s-nologin"));
check("  foreign-tenant excluded", !optsA.some(o => o.sellerId === "s-foreign"));
eq("  tenant B sees exactly 1 (Foreign)", (await listViewAsSellers(svc, TENANT_B)).length, 1);
eq("  no tenant → empty list", (await listViewAsSellers(svc, null)).length, 0);

/* ── 6 · gap-surface narrowing (leadInScope / scopeRowsToAssigned) ───────── */
// These two pure helpers are the single shared shape used by the four
// previously-leaking surfaces — Lead Detail, Company Detail, Opportunity
// Detail, Reports — so a seller (incl. an admin previewing as one) only sees
// their own assigned leads, while admins (null set) keep the tenant-wide view.
console.log("\n6. seller-scope narrowing — the fix for the 4 gap surfaces");

// Admin: null assigned-set → everything passes (tenant-wide unchanged).
eq("  admin (null) — single lead always in scope", leadInScope(null, "lead-x"), true);
const adminRows = [{ lead_id: "a" }, { lead_id: "b" }, { lead_id: "c" }];
eq("  admin (null) — row list unchanged", scopeRowsToAssigned(null, adminRows, r => r.lead_id).length, 3);

// Seller Isaac assigned to {l1, l2}.
const isaacLeads = new Set(["l1", "l2"]);
eq("  seller — assigned lead in scope (Lead/Opp Detail gate opens)", leadInScope(isaacLeads, "l1"), true);
eq("  seller — UNASSIGNED lead out of scope (→ notFound)", leadInScope(isaacLeads, "l9"), false);

// Company / Opportunity-rollup / Reports row narrowing.
const mixedRows = [
  { id: "r1", lead_id: "l1" }, // Isaac's
  { id: "r2", lead_id: "l2" }, // Isaac's
  { id: "r3", lead_id: "l3" }, // a PEER's — must be dropped
  { id: "r4", lead_id: null }, // no lead — must be dropped
];
const narrowed = scopeRowsToAssigned(isaacLeads, mixedRows, r => r.lead_id);
eq("  seller — only own rows survive", narrowed.length, 2);
check("  seller — peer's row is excluded", !narrowed.some(r => r.id === "r3"));
check("  seller — null-lead row is excluded", !narrowed.some(r => r.id === "r4"));

// Empty assigned-set (a seller with zero assigned leads) → sees nothing, but
// this is NOT the admin case: an empty Set must narrow to zero, never to all.
eq("  seller with 0 leads — nothing in scope", leadInScope(new Set<string>(), "l1"), false);
eq("  seller with 0 leads — empty row list", scopeRowsToAssigned(new Set<string>(), mixedRows, r => r.lead_id).length, 0);

/* ── 7 · read-only flag mirrored to the browser write-guard ─────────────── */
// getSupabaseBrowser() reads this flag to refuse direct browser writes during
// a preview (the mechanism that closes the non-/api write paths).
console.log("\n7. read-only flag (browser write-guard signal)");
eq("  defaults inactive", isViewAsActive(), false);
setViewAsActive(true);
eq("  active while previewing", isViewAsActive(), true);
setViewAsActive(false);
eq("  cleared on return to admin", isViewAsActive(), false);

/* ── 8 · campaign attachment upload — server-side authorization ──────────── */
// The relocated /api/campaigns/[id]/attachments upload authorizes SERVER-SIDE.
// campaigns RLS is TENANT-WIDE only, so RLS visibility alone is NOT enough — a
// seller must not act on a peer's campaign in the same tenant. We layer the
// canonical seller chokepoint (getMyAssignedUserId → assigned_user_id).
console.log("\n8. campaign attachment upload — server-side authz (incl. same-tenant peer seller)");

const ISAAC = "u-isaac", PEER = "u-peer";
const campA: CampaignRow = { id: "camp-A", assigned_user_id: ISAAC };   // Isaac's
const campB: CampaignRow = { id: "camp-B", assigned_user_id: PEER };    // same tenant, peer seller's
const status = (r: ReturnType<typeof campaignWriteAuthz>) => r.ok ? "ok" : r.status;

// Isaac (real seller): sellerUserId = his own id.
eq("  Isaac → own campaign A → allowed", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: "bio-SWL", campaign: campA, sellerUserId: ISAAC })), "ok");
eq("  Isaac → PEER's campaign B (same tenant) → 403", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: "bio-SWL", campaign: campB, sellerUserId: ISAAC })), 403);
eq("  Isaac → cross-tenant campaign (not visible) → 403", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: "bio-SWL", campaign: null, sellerUserId: ISAAC })), 403);
eq("  Isaac → nonexistent campaign (not visible) → 403", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: "bio-SWL", campaign: null, sellerUserId: ISAAC })), 403);
eq("  Isaac → own-tenant but UNASSIGNED campaign → 403", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: "bio-SWL", campaign: { id: "camp-U", assigned_user_id: null }, sellerUserId: ISAAC })), 403);

// Admin (owner/manager/super_admin): getMyAssignedUserId() === null → tenant-wide.
eq("  Admin → any own-tenant campaign (incl. a seller's) → allowed", status(campaignWriteAuthz({ userId: "u-admin", companyBioId: "bio-SWL", campaign: campB, sellerUserId: null })), "ok");
eq("  Admin → cross-tenant campaign (not visible) → 403", status(campaignWriteAuthz({ userId: "u-admin", companyBioId: "bio-SWL", campaign: null, sellerUserId: null })), 403);

// Auth preconditions.
eq("  no user → 401", status(campaignWriteAuthz({ userId: null, companyBioId: "bio-SWL", campaign: campA, sellerUserId: null })), 401);
eq("  no tenant → 403", status(campaignWriteAuthz({ userId: ISAAC, companyBioId: null, campaign: campA, sellerUserId: ISAAC })), 403);

// getVisibleCampaign reads under the caller's RLS session: only own-tenant rows
// surface; cross-tenant / unknown → null. Row carries assigned_user_id.
function fakeCampaignSvc(rows: CampaignRow[]) {
  return { from() { let data = rows.slice(); const q: Record<string, unknown> = { select() { return q; }, eq(_c: string, v: string) { data = data.filter(r => r.id === v); return q; }, maybeSingle() { return Promise.resolve({ data: data[0] ?? null }); } }; return q; } } as never;
}
const rlsSvc = fakeCampaignSvc([campA, campB]); // both own-tenant; a foreign one would simply be absent
eq("  getVisibleCampaign(own) → row with owner", (await getVisibleCampaign(rlsSvc, "camp-A"))?.assigned_user_id, ISAAC);
eq("  getVisibleCampaign(cross-tenant / absent) → null", await getVisibleCampaign(rlsSvc, "camp-foreign"), null);
eq("  getVisibleCampaign(unknown) → null", await getVisibleCampaign(rlsSvc, "camp-nope"), null);

/* ── 9 · Calls queue seller-scope (To Call · Awaiting Outcome · History) ──── */
// The last seller-scope gap: the `calls` table carries no assigned_user_id, so
// ownership is the LEAD's — a call belongs to a seller when its lead is in the
// seller's assigned set (getMyAssignedLeadIds). page.tsx scopes all three call
// cohorts through exactly that set; here we model each cohort with the same
// canonical predicate (scopeRowsToAssigned on lead_id) and prove:
//   · a seller sees only calls on their own leads (peer's call invisible)
//   · Real Isaac === Admin→View-As-Isaac (identical effective set → parity:
//     equal counts AND empty set-diff, per cohort)
//   · Admin (null set) sees the whole tenant's log, every cohort
console.log("\n9. Calls queue — seller-scope parity (To Call · Awaiting · History)");

type CallRow = { id: string; lead_id: string | null; cohort: "tocall" | "awaiting" | "history" };
// One tenant's call log. l1/l2 are Isaac's assigned leads (isaacLeads above);
// l3 is a PEER seller's; the null-lead row is an orphan dial-marker.
const callLog: CallRow[] = [
  { id: "k1", lead_id: "l1", cohort: "tocall" },   // Isaac's
  { id: "k2", lead_id: "l2", cohort: "tocall" },   // Isaac's
  { id: "k3", lead_id: "l3", cohort: "tocall" },   // PEER's — invisible to Isaac
  { id: "k4", lead_id: "l1", cohort: "awaiting" }, // Isaac's
  { id: "k5", lead_id: "l3", cohort: "awaiting" }, // PEER's — invisible to Isaac
  { id: "k6", lead_id: "l2", cohort: "history" },  // Isaac's
  { id: "k7", lead_id: "l3", cohort: "history" },  // PEER's — invisible to Isaac
  { id: "k8", lead_id: null, cohort: "history" },  // orphan — no lead, invisible to a seller
];
const COHORTS = ["tocall", "awaiting", "history"] as const;
const cohortRows = (c: CallRow["cohort"]) => callLog.filter(r => r.cohort === c);
const idsOf = (rows: CallRow[]) => new Set(rows.map(r => r.id));
const setDiff = (a: Set<string>, b: Set<string>) => [...a].filter(x => !b.has(x));

// Effective assigned set is IDENTICAL for real Isaac and for an admin
// previewing as Isaac — applyViewAs rewrites the effective userId to Isaac's,
// so getMyAssignedLeadIds() returns the same set on both paths.
const realIsaacSet = isaacLeads;
const viewAsIsaacSet = new Set(isaacLeads); // resolved the same way, modeled distinct

for (const c of COHORTS) {
  const rows = cohortRows(c);
  const real = scopeRowsToAssigned(realIsaacSet, rows, r => r.lead_id) as CallRow[];
  const viewAs = scopeRowsToAssigned(viewAsIsaacSet, rows, r => r.lead_id) as CallRow[];
  const admin = scopeRowsToAssigned(null, rows, r => r.lead_id) as CallRow[];
  // Parity: same counts and zero set-diff both ways.
  eq(`  ${c} — Real Isaac count === View-As Isaac count`, real.length, viewAs.length);
  check(`  ${c} — Real vs View-As set-diff empty`, setDiff(idsOf(real), idsOf(viewAs)).length === 0 && setDiff(idsOf(viewAs), idsOf(real)).length === 0);
  // Seller sees strictly fewer than admin whenever a peer/orphan row exists.
  check(`  ${c} — seller ⊆ admin (peer rows dropped)`, real.length < admin.length);
  // No peer (l3) or orphan (null) row ever survives the seller view.
  check(`  ${c} — no peer/orphan call visible to Isaac`, !real.some(r => r.lead_id !== "l1" && r.lead_id !== "l2"));
}

// Explicit own-vs-peer at the row level (the acceptance case the boss named).
eq("  own call (l1) visible to Isaac", leadInScope(isaacLeads, "l1"), true);
eq("  peer's call (l3) invisible to Isaac", leadInScope(isaacLeads, "l3"), false);
// Admin normal — both own and peer calls visible (tenant-wide unchanged).
eq("  admin sees own-lead call", leadInScope(null, "l1"), true);
eq("  admin sees peer-lead call", leadInScope(null, "l3"), true);

console.log(`\n${"─".repeat(70)}\n  ${pass} passed · ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
console.log("  View-as narrows scope and never crosses a tenant.\n");
