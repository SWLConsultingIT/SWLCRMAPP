// ─────────────────────────────────────────────────────────────────────────
// Admin "View as Seller" — authenticated visual capture.
//
// Opens a HEADED browser against the LOCAL app (which has these changes) pointed
// at PRODUCTION data, waits for YOU to log in once as an admin, then drives the
// real UI to capture the 9 review frames as the actual product — TopHeader,
// sidebar, seller banner, Return-to-Admin, real body, dark, 1024.
//
//   1. terminal A:  npm run dev:prod-readonly       # needs .env.prod-readonly.local
//   2. terminal B:  npx tsx scripts/capture-view-as.mts
//   3. log in in the window that opens, as an admin of Isaac's tenant (SWL)
//   4. press Enter in terminal B — it captures the rest headlessly
//
// It never types or reads a password. The session lands in .auth/swl.json
// (gitignored). Delete it when done. READ-ONLY: it only navigates + toggles the
// view-as cookie via the app's own /api/auth/view-as (writes stay blocked).
// ─────────────────────────────────────────────────────────────────────────

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";

const BASE = process.env.APP_URL ?? "http://localhost:3002";
const STATE = ".auth/swl.json";
const SHOTS = process.env.SHOTS_DIR ?? "docs/audits/view-as/shots";

// Isaac — SWL Consulting seller (sellers.id). The one previewed in the report.
const ISAAC_SELLER_ID = process.env.ISAAC_SELLER_ID ?? "0c7536e0-c71f-4468-aeaf-45d2b3b589f7";
// One lead assigned to Isaac, for the Lead Detail frame (measured in parity).
const ISAAC_LEAD_ID = process.env.ISAAC_LEAD_ID ?? "ce197307-1c9d-4643-99b6-cc3fa5747fe8";

const ask = (q: string) => new Promise<void>(res => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, () => { rl.close(); res(); });
});

async function main() {
  mkdirSync(".auth", { recursive: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const ctx = existsSync(STATE)
    ? await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    console.log(`\n  A browser window is open at ${BASE}.`);
    console.log("  Log in as an ADMIN of Isaac's tenant (SWL). Nothing is typed or read from here.\n");
    await ask("  Press Enter once the dashboard has loaded… ");
    await ctx.storageState({ path: STATE });
    console.log(`  Session saved to ${STATE} (gitignored). Delete it when you are done.\n`);
  } else {
    console.log("\n  Reusing the saved session.\n");
  }

  const shot = async (name: string) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  captured ${name}`);
  };
  const setViewAs = async (sellerId: string | null) => {
    await page.evaluate(async (id) => {
      await fetch("/api/auth/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerId: id }) });
    }, sellerId);
  };
  const setTheme = async (mode: "light" | "dark") => {
    await ctx.addCookies([{ name: "swl-theme", value: mode, url: BASE }]);
  };

  // Make sure we start clean (admin), light.
  await setViewAs(null);
  await setTheme("light");

  // A · Admin normal
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("A-admin-normal");

  // B · dropdown open — click the View As control in the header
  try {
    await page.getByRole("button", { name: /view as/i }).first().click({ timeout: 5000 });
    await shot("B-dropdown-open");
    await page.keyboard.press("Escape");
  } catch { console.log("  (B) could not open the dropdown automatically — capture it by hand if needed"); }

  // Activate the preview as Isaac, then walk the seller surfaces.
  await setViewAs(ISAAC_SELLER_ID);

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("C-isaac-dashboard");
  await page.goto(`${BASE}/leads`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("D-isaac-leads");
  await page.goto(`${BASE}/leads/${ISAAC_LEAD_ID}`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("E-isaac-lead-detail");
  await page.goto(`${BASE}/queue`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("F-isaac-inbox");
  await page.goto(`${BASE}/activities`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("G-isaac-activities");

  // H · 1024 width (still in preview)
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("H-isaac-1024");
  await page.setViewportSize({ width: 1440, height: 900 });

  // I · dark mode (still in preview)
  await setTheme("dark");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await shot("I-isaac-dark");

  // Leave clean: back to Admin, light.
  await setViewAs(null);
  await setTheme("light");

  await browser.close();
  console.log(`\n  9 frames in ${SHOTS}/  (A admin · B dropdown · C-G Isaac surfaces · H 1024 · I dark)\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
