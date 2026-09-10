// i18n parity + hygiene tests. Part of `npm test`.
//
// The mixed-language bug this guards against: a key added to `en` but not to
// `es`/`it` renders English inside an otherwise translated screen, and nobody
// notices until a customer does. These assertions make that a build failure.

import { en, es, it, dicts, LOCALES, normalizeLocale, isLocale, intlTag, type Locale } from "@/lib/i18n-dicts";

let failed = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) { failed++; console.error("  ✗ " + msg); }
}

const byLocale: Record<Locale, Record<string, string>> = { en, es, it };

console.log("i18n · dictionary parity");

// 1. Every locale declared in LOCALES has a dictionary, and vice versa.
ok(LOCALES.length === Object.keys(dicts).length, "LOCALES and dicts have the same size");
for (const l of LOCALES) ok(!!dicts[l.id], `dicts has an entry for "${l.id}"`);

// 2. Identical key sets across every locale. This is the core guarantee.
const base = Object.keys(en).sort();
for (const l of LOCALES) {
  const keys = Object.keys(byLocale[l.id]).sort();
  const missing = base.filter(k => !(k in byLocale[l.id]));
  const extra = keys.filter(k => !(k in en));
  ok(missing.length === 0, `${l.id}: ${missing.length} key(s) missing vs en → ${missing.slice(0, 8).join(", ")}`);
  ok(extra.length === 0, `${l.id}: ${extra.length} key(s) not in en → ${extra.slice(0, 8).join(", ")}`);
}

// 3. No empty translation where English has text — an empty string renders as
//    a blank label, which is worse than showing English.
for (const l of LOCALES) {
  const blanks = base.filter(k => en[k].trim() !== "" && byLocale[l.id][k].trim() === "");
  ok(blanks.length === 0, `${l.id}: ${blanks.length} blank value(s) where en has text → ${blanks.slice(0, 8).join(", ")}`);
}

// 4. Placeholder sets must match. `{n}` in en but `{count}` in it means the
//    number silently disappears from the Italian string.
const tokensOf = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
for (const l of LOCALES) {
  if (l.id === "en") continue;
  const bad: string[] = [];
  for (const k of base) {
    const a = tokensOf(en[k]);
    const b = tokensOf(byLocale[l.id][k]);
    // A translation may legitimately drop a token (different phrasing), but it
    // must never invent one that the caller does not supply.
    for (const t of b) if (!a.has(t)) bad.push(`${k} → {${t}}`);
  }
  ok(bad.length === 0, `${l.id}: ${bad.length} unknown placeholder(s) → ${bad.slice(0, 8).join(", ")}`);
}

console.log("i18n · locale normalization");

// 5. normalizeLocale is the single coercion point — it must accept every
//    supported locale and reject everything else without throwing.
for (const l of LOCALES) ok(normalizeLocale(l.id) === l.id, `normalizeLocale("${l.id}") is a no-op`);
for (const v of [null, undefined, "", "EN", "fr", "pt-BR", 42, {}, []]) {
  ok(normalizeLocale(v) === "en", `normalizeLocale(${JSON.stringify(v)}) falls back to en`);
}
ok(isLocale("it"), 'isLocale("it")');
ok(!isLocale("fr"), '!isLocale("fr")');

// 6. Every locale has a usable BCP-47 tag for Intl formatting.
for (const l of LOCALES) {
  ok(intlTag(l.id) === l.intlTag, `intlTag("${l.id}") === "${l.intlTag}"`);
  ok(new Intl.NumberFormat(l.intlTag).format(1234.5).length > 0, `${l.intlTag} is a valid Intl tag`);
}

console.log(`\n${checks - failed}/${checks} i18n assertions passed`);
if (failed > 0) { console.error(`${failed} i18n assertion(s) FAILED`); process.exit(1); }
