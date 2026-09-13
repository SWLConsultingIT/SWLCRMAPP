#!/usr/bin/env npx tsx
// Hace cumplir la direccion de dependencias de docs/ARCHITECTURE.md.
//
// Las reglas de arquitectura que no se chequean se violan en tres semanas. Esto
// resuelve todos los imports del arbol y falla si alguna de estas se rompe:
//
//   1. shared/ no importa features/
//   2. shared/ no importa app/
//   3. features/<x>/ no importa features/<y>/   (un feature no conoce a otro)
//   4. nada importa desde app/ salvo app/        (app es routing, no libreria)
//
// Las violaciones desde scripts/ salen como WARNING y no rompen el gate: son
// herramientas, no codigo de la app. Se reportan igual para que no se olviden
// —hoy hay una, qa-console leyendo un modulo de app/dashboard-console, que se
// resuelve cuando migre Dashboard.
//
// Run: npx tsx scripts/check-boundaries.mts

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n").filter(f => /\.(ts|tsx|mts)$/.test(f));
const fileSet = new Set(files);

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  base = base.replace(/\.(ts|tsx|mts)$/, "");
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fileSet.has(c)) return c;
  }
  return fileSet.has(base) ? base : null;
}

const IMPORT = /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;
const featureOf = (p: string) => p.startsWith("features/") ? p.split("/")[1] : null;

type V = { rule: string; from: string; to: string };
const violations: V[] = [];
const reported: V[] = [];

for (const f of files) {
  if (!existsSync(f)) continue;
  const src = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");  // sin comentarios
  for (const m of src.matchAll(IMPORT)) {
    const to = resolve(m[1], f);
    if (!to) continue;
    if (f.startsWith("shared/") && to.startsWith("features/"))
      violations.push({ rule: "1 · shared -> features", from: f, to });
    if (f.startsWith("shared/") && to.startsWith("app/"))
      violations.push({ rule: "2 · shared -> app", from: f, to });
    const a = featureOf(f), b = featureOf(to);
    if (a && b && a !== b)
      violations.push({ rule: "3 · feature -> otro feature", from: f, to });
    if (to.startsWith("app/") && !f.startsWith("app/"))
      violations.push({ rule: "4 · algo de afuera importa app/", from: f, to });
    if (f.startsWith("integrations/") && to.startsWith("features/"))
      violations.push({ rule: "5 · integrations -> features", from: f, to });
    if (f.startsWith("integrations/") && to.startsWith("app/"))
      violations.push({ rule: "6 · integrations -> app", from: f, to });
    if (f.startsWith("integrations/") && to.startsWith("shared/ui"))
      violations.push({ rule: "7 · integrations -> shared/ui", from: f, to });
    if (f.startsWith("shared/") && to.startsWith("integrations/"))
      reported.push({ rule: "shared -> integrations (permitido)", from: f, to });
  }
}

for (const r of reported) console.log(`\ni shared -> integrations\n     ${r.from}\n       -> ${r.to}`);

const warn = violations.filter(v => v.from.startsWith("scripts/"));
const hard = violations.filter(v => !v.from.startsWith("scripts/"));

for (const v of warn) console.log(`\n⚠ warning (herramienta, no rompe el gate)\n  [${v.rule}]\n     ${v.from}\n       -> ${v.to}`);

if (hard.length === 0) {
  console.log(`\n✓ fronteras OK — ${files.length} archivos, 0 violaciones duras, ${warn.length} warning(s), ${reported.length} arista(s) shared->integrations\n`);
  process.exit(0);
}
console.log(`\n✗ ${hard.length} violacion(es) de frontera:\n`);
for (const v of hard) console.log(`  [${v.rule}]\n     ${v.from}\n       -> ${v.to}`);
console.log("");
process.exit(1);
