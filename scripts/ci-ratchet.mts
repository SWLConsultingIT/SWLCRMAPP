// Ratchet de calidad para CI.
//
// El proyecto arrastra deuda: `next.config.ts` tiene `ignoreBuildErrors: true`,
// así que el build de Vercel nunca validó tipos, y hay 1500+ hallazgos de lint
// acumulados. Poner `tsc` o `eslint` como gate duro dejaría CI rojo para
// siempre y nadie lo miraría.
//
// Este script hace lo otro: mide, compara contra un baseline congelado, y falla
// SÓLO si el número creció. La deuda existente no molesta; la deuda nueva no
// entra. Cuando bajás el número, bajá el baseline en el mismo PR.
//
// Uso:  npx tsx scripts/ci-ratchet.mts          (compara contra el baseline)
//       npx tsx scripts/ci-ratchet.mts --update (reescribe el baseline)

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_PATH = new URL("./ci-baseline.json", import.meta.url);

type Baseline = {
  typeErrors: number;
  lintErrors: number;
  lintWarnings: number;
  note: string;
  updatedAt: string;
};

/** Corre un comando y devuelve stdout+stderr sin explotar si el exit code != 0. */
function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

/**
 * Errores de tipo, excluyendo `.next/` — ahí vive `dev/types/validator.ts`,
 * que lo genera Next y cuyo contenido depende de qué páginas se visitaron en
 * el último `next dev`. Contarlo haría el ratchet no determinístico.
 */
function countTypeErrors(): number {
  const out = run("npx tsc --noEmit");
  return out
    .split("\n")
    .filter((l) => /error TS\d+/.test(l))
    .filter((l) => !l.includes(".next/"))
    .length;
}

/** Parsea el resumen de eslint: "✖ 1548 problems (1195 errors, 353 warnings)". */
function countLint(): { errors: number; warnings: number } {
  const out = run("npx eslint");
  const m = out.match(/(\d+)\s+errors?,\s+(\d+)\s+warnings?/);
  if (!m) return { errors: 0, warnings: 0 };
  return { errors: Number(m[1]), warnings: Number(m[2]) };
}

const measured = (() => {
  console.log("Midiendo tipos…");
  const typeErrors = countTypeErrors();
  console.log("Midiendo lint…");
  const lint = countLint();
  return { typeErrors, lintErrors: lint.errors, lintWarnings: lint.warnings };
})();

if (process.argv.includes("--update")) {
  const next: Baseline = {
    ...measured,
    note:
      "Deuda congelada. Bajar estos números cuando se arreglen errores; " +
      "nunca subirlos para que pase CI.",
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log("\nBaseline actualizado:", next);
  process.exit(0);
}

const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

const checks = [
  { name: "errores de tipo (tsc --noEmit)", got: measured.typeErrors, max: baseline.typeErrors },
  { name: "errores de lint", got: measured.lintErrors, max: baseline.lintErrors },
  { name: "warnings de lint", got: measured.lintWarnings, max: baseline.lintWarnings },
];

let failed = false;
console.log("");
for (const c of checks) {
  if (c.got > c.max) {
    failed = true;
    console.log(`✗ ${c.name}: ${c.got} (baseline ${c.max}, +${c.got - c.max} nuevos)`);
  } else if (c.got < c.max) {
    console.log(`↓ ${c.name}: ${c.got} (baseline ${c.max}) — bajá el baseline con --update`);
  } else {
    console.log(`✓ ${c.name}: ${c.got}`);
  }
}

if (failed) {
  console.log(
    "\nCI falla porque el cambio agrega errores nuevos. Arreglalos —\n" +
      "no subas el baseline para taparlos.",
  );
  process.exit(1);
}
console.log("\nSin deuda nueva.");
