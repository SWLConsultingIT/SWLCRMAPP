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
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createInterface } from "readline";

const BASE = process.env.APP_URL ?? "http://localhost:3002";
const STATE = ".auth/swl.json";
const SHOTS = process.env.SHOTS_DIR ?? "docs/audits/phase3a/shots";

const ask = (q: string) => new Promise<void>(res => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, () => { rl.close(); res(); });
});

// Window comes from the environment so the captures always line up with the
// baseline the independent verifier was generated for.
const FROM = process.env.SHOT_FROM ?? "2026-08-11";
const TO = process.env.SHOT_TO ?? "2026-09-09";
const LUCIA = "5e5085ca-4bb4-4bac-a4b6-323bf8917f35";
const ODOO_CAMPAIGN = "Odoo Implementation — Argentina - Multicanal";
const ODOO_ICP = "9afe82a7-8310-4b8e-ad91-933156134ee2";
const W = `from=${FROM}&to=${TO}`;

const CAPTURES: { name: string; url: string }[] = [
  { name: "overview-30d",      url: `/?${W}&tab=overview` },
  { name: "sellers-30d",       url: `/?${W}&tab=sellers` },
  { name: "campaigns-30d",     url: `/?${W}&tab=campaigns` },
  { name: "icps-30d",          url: `/?${W}&tab=icps` },
  { name: "channels-30d",      url: `/?${W}&tab=channels` },
  { name: "overview-seller",   url: `/?${W}&sellers=${LUCIA}` },
  { name: "overview-campaign", url: `/?${W}&campaigns=${encodeURIComponent(ODOO_CAMPAIGN)}` },
  { name: "overview-icp",      url: `/?${W}&icps=${ODOO_ICP}` },
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

  // STEP D — a screenshot proves a page rendered, not that the number on it
  // is right. Scrape the Calls card's five values out of the DOM so they can
  // be diffed against the independent verifier.
  const scraped: Record<string, Record<string, number | null>> = {};
  for (const c of CAPTURES) {
    await page.goto(BASE + c.url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${c.name}.png`, fullPage: true });

    const values = await page.evaluate(() => {
      const num = (s: string | null | undefined) => {
        if (!s) return null;
        const m = s.replace(/[.,](?=\d{3}\b)/g, "").match(/-?\d+(\.\d+)?/);
        return m ? Number(m[0]) : null;
      };
      const out: Record<string, number | null> = {};
      // The Calls card renders its five sub-counts as label/value pairs.
      for (const cell of Array.from(document.querySelectorAll("div"))) {
        const label = cell.querySelector("p:first-child")?.textContent?.trim().toLowerCase();
        const value = cell.querySelector("p:nth-child(2)")?.textContent?.trim();
        if (!label || value == null) continue;
        if (label === "attempted") out.attempted = num(value);
        else if (label.startsWith("confirmed conn")) out.confirmedConnected = num(value);
        else if (label.startsWith("not connected")) out.confirmedNotConnected = num(value);
        else if (label === "unknown") out.unknown = num(value);
      }
      const rateEl = Array.from(document.querySelectorAll("span"))
        .find(s => /confirmed connect rate/i.test(s.textContent ?? ""));
      out.confirmedConnectRate = rateEl ? num(rateEl.textContent) : null;
      return out;
    });
    scraped[c.name] = values;
    console.log(`  captured ${c.name}  ${JSON.stringify(values)}`);
  }
  writeFileSync(`${SHOTS}/visible-numbers.json`, JSON.stringify(scraped, null, 2) + "\n");
  await browser.close();
  console.log(`\n  Screenshots + scraped numbers in ${SHOTS}/\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
