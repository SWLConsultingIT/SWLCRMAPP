// Unit tests for the Activities domain (Phase 1). Pure — no database.
// Run: npx tsx scripts/test-activities.mts
//
// Pins the two rules that must not drift: bucket derivation from due_at (Overdue
// / Today / Upcoming, in the team business tz) and create-payload validation.

import { bucketActivity, normalizeActivityCreate, wallTimeToUtcIso, isValidTimeZone } from "../lib/activities.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

/* ── bucketActivity — business tz is UTC−3, so "today" = [03:00Z, next 02:59:59.999Z] ── */
// Pin now = 2026-08-10T12:00:00Z (09:00 local, Monday). Today = 2026-08-10.
const NOW = Date.parse("2026-08-10T12:00:00Z");

console.log("\nbucketActivity");
eq("pending, due yesterday → overdue", bucketActivity({ status: "pending", due_at: "2026-08-09T12:00:00Z" }, NOW), "overdue");
eq("pending, due today midday → today", bucketActivity({ status: "pending", due_at: "2026-08-10T20:00:00Z" }, NOW), "today");
eq("pending, due 23:00 local (02:00Z next) → today", bucketActivity({ status: "pending", due_at: "2026-08-11T02:00:00Z" }, NOW), "today");
eq("pending, due tomorrow → upcoming", bucketActivity({ status: "pending", due_at: "2026-08-11T12:00:00Z" }, NOW), "upcoming");
eq("pending, no due date → no_date", bucketActivity({ status: "pending", due_at: null }, NOW), "no_date");
eq("pending, exactly day start 03:00Z → today", bucketActivity({ status: "pending", due_at: "2026-08-10T03:00:00.000Z" }, NOW), "today");
eq("pending, 1ms before day start → overdue", bucketActivity({ status: "pending", due_at: "2026-08-10T02:59:59.999Z" }, NOW), "overdue");
eq("completed ignores due date → completed", bucketActivity({ status: "completed", due_at: "2026-08-09T12:00:00Z" }, NOW), "completed");
eq("cancelled ignores due date → cancelled", bucketActivity({ status: "cancelled", due_at: "2026-08-11T12:00:00Z" }, NOW), "cancelled");
eq("garbage due date → no_date", bucketActivity({ status: "pending", due_at: "not-a-date" }, NOW), "no_date");

/* ── normalizeActivityCreate ── */
console.log("\nnormalizeActivityCreate");
{
  const r = normalizeActivityCreate({ title: "  Call Juan  " });
  eq("minimal valid ok", r.ok, true);
  if (r.ok) {
    eq("title trimmed", r.value.title, "Call Juan");
    eq("type defaults to task", r.value.type, "task");
    eq("source defaults to manual", r.value.source, "manual");
    eq("due_at null when absent", r.value.due_at, null);
    eq("priority null when absent", r.value.priority, null);
  }
}
eq("missing title rejected", normalizeActivityCreate({}).ok, false);
eq("whitespace title rejected", normalizeActivityCreate({ title: "   " }).ok, false);
eq("too-long title rejected", normalizeActivityCreate({ title: "x".repeat(201) }).ok, false);
eq("invalid priority rejected", normalizeActivityCreate({ title: "t", priority: "urgent" }).ok, false);
eq("invalid due_at rejected", normalizeActivityCreate({ title: "t", due_at: "nope" }).ok, false);
{
  const r = normalizeActivityCreate({ title: "t", type: "call", due_at: "2026-08-10T10:00:00Z", priority: "high", lead_id: "abc", source: "call_callback", source_reference_id: "cid" });
  eq("full valid ok", r.ok, true);
  if (r.ok) {
    eq("type kept", r.value.type, "call");
    eq("due_at iso-normalized", r.value.due_at, "2026-08-10T10:00:00.000Z");
    eq("priority kept", r.value.priority, "high");
    eq("lead_id kept", r.value.lead_id, "abc");
    eq("source kept", r.value.source, "call_callback");
  }
}
eq("unknown type falls back to task", (() => { const r = normalizeActivityCreate({ title: "t", type: "weird" }); return r.ok && r.value.type; })(), "task");

/* ── timezone: wall-clock in a zone → absolute UTC, DST-correct ── */
console.log("\nwallTimeToUtcIso (due_tz semantics)");
eq("Berlin winter 15:30 = 14:30Z (CET)", wallTimeToUtcIso("2026-01-15", "15:30", "Europe/Berlin"), "2026-01-15T14:30:00.000Z");
eq("Berlin summer 15:30 = 13:30Z (CEST)", wallTimeToUtcIso("2026-07-15", "15:30", "Europe/Berlin"), "2026-07-15T13:30:00.000Z");
eq("Buenos Aires 09:00 = 12:00Z (ART, no DST)", wallTimeToUtcIso("2026-07-15", "09:00", "America/Argentina/Buenos_Aires"), "2026-07-15T12:00:00.000Z");
eq("New York winter 09:00 = 14:00Z (EST)", wallTimeToUtcIso("2026-01-15", "09:00", "America/New_York"), "2026-01-15T14:00:00.000Z");
eq("New York summer 09:00 = 13:00Z (EDT)", wallTimeToUtcIso("2026-07-15", "09:00", "America/New_York"), "2026-07-15T13:00:00.000Z");
eq("invalid tz → null", wallTimeToUtcIso("2026-07-15", "09:00", "Not/AZone"), null);
eq("bad date → null", wallTimeToUtcIso("nope", "09:00", "Europe/Berlin"), null);
eq("isValidTimeZone Europe/Berlin", isValidTimeZone("Europe/Berlin"), true);
eq("isValidTimeZone junk", isValidTimeZone("Mars/Olympus"), false);

console.log(`\nActivities: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
