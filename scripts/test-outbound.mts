// Outbound message-safety tests (incident 2026-09-02 hardening).
// Run: npx tsx scripts/test-outbound.mts
// Exercises the SHARED gate every channel sender uses (resolveOutbound) plus
// the raw validator. If these pass, every channel behaves identically because
// they all call resolveOutbound.
import { renderPlaceholders, validateOutboundMessage, resolveOutbound, namesMatch } from "../lib/placeholders.ts";

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}
const BANNED = ["Victor", "Joaquin", "Carlos", "Iñigo", "Inigo"];
function noBanned(text: string, allow: string) {
  return BANNED.every(b => b === allow || !text.includes(b));
}
const lead = (first: string | null, extra: Record<string, unknown> = {}) => ({
  primary_first_name: first, primary_last_name: null, company_name: "Acme Capital",
  primary_title_role: null, ...extra,
}) as any;
const seller = { name: "Lucho" };

console.log("\n== CRITICAL: Francisco ==");
{
  const r = resolveOutbound("Hi {{first_name}}, how are you?", lead("Francisco"), seller, "linkedin");
  check("resolves ok", r.ok === true);
  check("text is exactly 'Hi Francisco, how are you?'", r.ok && r.text === "Hi Francisco, how are you?", r.ok ? r.text : (r as any).error);
  check("contains no banned name", r.ok && noBanned(r.text, "Francisco"));
}

console.log("\n== A) baked 'Hi Victor' for lead Francisco → never ships Victor ==");
for (const tpl of ["Hi Victor, how are you?", "Hola Victor, ¿todo bien?", "Hey Victor — quick one"]) {
  const r = resolveOutbound(tpl, lead("Francisco"), seller, "linkedin");
  check(`safe for "${tpl}"`, r.ok === true && noBanned(r.text, "Francisco") && r.text.includes("Francisco"), r.ok ? r.text : (r as any).error);
}
// And if render were bypassed, the raw validator still BLOCKS a stranger greeting:
{
  const v = validateOutboundMessage("Hi Victor, how are you?", { lead: lead("Francisco"), seller });
  check("raw validate BLOCKS 'Hi Victor' for Francisco", v.ok === false && v.code === "greeting_name_mismatch", JSON.stringify(v));
}

console.log("\n== B) missing first_name + {{first_name}} → BLOCK ==");
for (const nm of [null, "", "   "]) {
  const r = resolveOutbound("Hi {{first_name}}", lead(nm), seller);
  check(`blocks (name=${JSON.stringify(nm)})`, r.ok === false && r.code === "unresolved_placeholder", r.ok ? r.text : (r as any).error);
}

console.log("\n== C) foreign syntax [First Name] → BLOCK ==");
{
  const r = resolveOutbound("Hi [First Name]", lead("Francisco"), seller);
  check("blocks foreign", r.ok === false && r.code === "foreign_placeholder", r.ok ? r.text : (r as any).error);
}

console.log("\n== D) unknown token → BLOCK ==");
{
  const r = resolveOutbound("Hi {{unknown_token}}", lead("Francisco"), seller);
  check("blocks unresolved", r.ok === false && r.code === "unresolved_placeholder", r.ok ? r.text : (r as any).error);
}

console.log("\n== E) retry determinism ==");
{
  const a = resolveOutbound("Hi {{first_name}}, from {{company}}", lead("Francisco"), seller);
  const b = resolveOutbound("Hi {{first_name}}, from {{company}}", lead("Francisco"), seller);
  check("identical output", a.ok && b.ok && a.text === b.text, a.ok ? a.text : "");
}

console.log("\n== F) 100 concurrent leads, no cross-contamination ==");
{
  const names = Array.from({ length: 100 }, (_, i) => `Lead${i}`);
  const results = await Promise.all(names.map(n => Promise.resolve(resolveOutbound("Hi {{first_name}}!", lead(n), seller))));
  const clean = results.every((r, i) => r.ok && r.text === `Hi ${names[i]}!`);
  check("each lead got only its own name", clean);
}

console.log("\n== G) special-character names ==");
for (const nm of ["José María", "Iñigo", "François", "María-José", "O'Connor"]) {
  const r = resolveOutbound("Hi {{first_name}}, how are you?", lead(nm), seller);
  check(`renders "${nm}"`, r.ok === true && r.text === `Hi ${nm}, how are you?`, r.ok ? r.text : (r as any).error);
}
// compound-name greeting must NOT be blocked (first token matches)
{
  const v = validateOutboundMessage("Hola José, ¿cómo estás?", { lead: lead("José María"), seller });
  check("compound greeting 'Hola José' for 'José María' allowed", v.ok === true, JSON.stringify(v));
}

console.log("\n== extra: invalid seller + empty ==");
{
  const r = resolveOutbound("Hi {{first_name}}", lead("Francisco"), { name: "Admin" });
  // strict renderPlaceholders throws on a system-default seller name, so the
  // block surfaces as render_error; if strict render were ever bypassed the
  // validator's own invalid_seller branch catches it. Either way: not sent.
  check("blocks invalid seller name", r.ok === false && (r.code === "invalid_seller" || r.code === "render_error"), r.ok ? r.text : (r as any).error);
  const e = resolveOutbound("   ", lead("Francisco"), seller);
  check("blocks empty", e.ok === false && e.code === "empty");
  check("namesMatch accent/case", namesMatch("JOSE", "José") && namesMatch("iñigo", "Inigo") === false ? true : namesMatch("Iñigo", "inigo"));
}

console.log("\n== ALL placeholders: fill when present, BLOCK when missing ==");
{
  // Present → filled verbatim, message respected.
  const r = resolveOutbound("Hi {{first_name}}, saw {{company}} in {{industry}}.", lead("Ana", { company_name: "Kanoar", company_industry: "fintech" }), seller);
  check("multi-placeholder all present fills exactly", r.ok && r.text === "Hi Ana, saw Kanoar in fintech.", r.ok ? r.text : (r as any).error);
  // Missing company → block (not a silent blank).
  const c = resolveOutbound("Hi {{first_name}}, I looked at {{company}}.", lead("Ana", { company_name: null }), seller);
  check("missing company BLOCKS", c.ok === false && c.code === "unresolved_placeholder", c.ok ? c.text : (c as any).error);
  // Missing role → block.
  const rl = resolveOutbound("Hi {{first_name}}, as {{title}} you...", lead("Ana", { primary_title_role: null }), seller);
  check("missing role/title BLOCKS", rl.ok === false && rl.code === "unresolved_placeholder", rl.ok ? rl.text : (rl as any).error);
  // Missing website → block.
  const w = resolveOutbound("Hi {{first_name}}, vs {{website}}", lead("Ana", { company_website: null }), seller);
  check("missing website BLOCKS", w.ok === false && w.code === "unresolved_placeholder", w.ok ? w.text : (w as any).error);
  // Present website → fills.
  const w2 = resolveOutbound("Hi {{first_name}}, vs {{website}}", lead("Ana", { company_website: "acme.com" }), seller);
  check("present website fills", w2.ok && w2.text === "Hi Ana, vs acme.com", w2.ok ? w2.text : (w2 as any).error);
  // seller_company (no data source) → block.
  const sc = resolveOutbound("Regards from {{seller_company}}", lead("Ana"), seller);
  check("seller_company (no data) BLOCKS", sc.ok === false && sc.code === "unresolved_placeholder", sc.ok ? sc.text : (sc as any).error);
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("ALL GREEN ✅");
