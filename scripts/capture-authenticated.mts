// ─────────────────────────────────────────────────────────────────────────
// PHASE 2 · DELIVERY 3 — authenticated visual validation.
//
// Opens a HEADED browser against a local app pointed at production, waits
// for YOU to log in by hand, then reuses that session to capture the tabs.
//
//   1. terminal A:  npm run dev:prod-readonly
//   2. terminal B:  npx tsx scripts/capture-authenticated.mts
//   3. log in in the window that opens, with your own SWL user
//   4. press Enter in terminal B
//
// It never asks for, reads, types or stores a password. The session lands in
// .auth/swl.json, which is gitignored — cookies and tokens are never
// committed. Delete it when you are done: it is a live session.
// ─────────────────────────────────────────────────────────────────────────

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";

const BASE = process.env.APP_URL ?? "http://localhost:3002";
const STATE = ".auth/swl.json";
const SHOTS = "docs/audits/phase2-delivery3/shots";

const ask = (q: string) => new Promise<void>(res => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, () => { rl.close(); res(); });
});

const CAPTURES: { name: string; url: string }[] = [
  { name: "overview-30d",        url: "/?from=2026-08-10&to=2026-09-08&tab=overview" },
  { name: "sellers-30d",         url: "/?from=2026-08-10&to=2026-09-08&tab=sellers" },
  { name: "campaigns-30d",       url: "/?from=2026-08-10&to=2026-09-08&tab=campaigns" },
  { name: "icps-30d",            url: "/?from=2026-08-10&to=2026-09-08&tab=icps" },
  { name: "channels-30d",        url: "/?from=2026-08-10&to=2026-09-08&tab=channels" },
  { name: "overview-seller",     url: "/?from=2026-08-10&to=2026-09-08&sellers=5e5085ca-4bb4-4bac-a4b6-323bf8917f35" },
  { name: "overview-campaign",   url: "/?from=2026-08-10&to=2026-09-08&campaigns=" + encodeURIComponent("Odoo Implementation — Argentina - Multicanal") },
  { name: "overview-icp",        url: "/?from=2026-08-10&to=2026-09-08&icps=9afe82a7-8310-4b8e-ad91-933156134ee2" },
];

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
    console.log("  Log in with your own SWL user. Nothing is typed or read from here.\n");
    await ask("  Press Enter once the dashboard has loaded… ");
    await ctx.storageState({ path: STATE });
    console.log(`  Session saved to ${STATE} (gitignored). Delete it when you are done.\n`);
  } else {
    console.log("\n  Reusing the saved session.\n");
  }

  for (const c of CAPTURES) {
    await page.goto(BASE + c.url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/${c.name}.png`, fullPage: true });
    console.log(`  captured ${c.name}`);
  }
  await browser.close();
  console.log(`\n  Screenshots in ${SHOTS}/\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
