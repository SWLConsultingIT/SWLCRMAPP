import { loadConsoleSource, buildIndex, buildOverview, buildTabs } from "../lib/console-data.ts";
// The builders take the caller's translator. This harness checks SHAPE, not
// copy, so it passes one that echoes the key.
const t = (key: string) => key;
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);
const f = { from: day(new Date(Date.now() - 29 * 86_400_000)), to: day(new Date()), bioId: "7c02e222-be59-416d-9434-acf4685f8590" };
const ix = buildIndex(await loadConsoleSource(f.bioId), f);
const D = buildOverview(ix, f, t) as any, T = buildTabs(ix, t) as any;
let bad = 0;
const need = (obj: any, keys: string[], label: string) => {
  for (const k of keys) if (obj[k] === undefined) { console.log(`  ✗ ${label}.${k} FALTA`); bad++; }
};
need(D, ["period","funnel","replyRates","otherChannel","linkedinNote","rankedBy","campaigns","campaignsNote","sellers","sellersNote","replyQuality","activity","timing","workspace","filters"], "D");
need(T, ["icps","icpsTotals","icpsNote","icpTouchNote","icpMatrixNote","icpWorthALook","campaigns","campaignGroups","flowDetail","campaignsNote","flowDetailNote","stepsNote","campaignsRemoved","channelCards","channelWhatsApp","headToHeadNote","channelWorthALook","sellers","sellerCalls","sellerCallsTotal","sellerDaily","teamHealth","teamAlerts","sellerInsights","WINDOW_DAYS","WINDOW_START","WINDOW_END"], "T");
need(T.teamHealth, ["activeSellers","totalSellers","contacted","sent","calls","replies","positive","replyRate","connectRate","queue","unattributedReplies"], "teamHealth");
// every flow row must have a drilldown, and every seller a daily series
for (const c of T.campaigns) if (!T.flowDetail[c.name]) { console.log(`  ✗ flowDetail falta para ${c.name}`); bad++; }
for (const s of T.sellers) if (!T.sellerDaily[s.name]) { console.log(`  ✗ sellerDaily falta para ${s.name}`); bad++; }
for (const s of T.sellers) if (!T.sellerCalls.find((x: any) => x.name === s.name)) { console.log(`  ✗ sellerCalls falta para ${s.name}`); bad++; }
// invariantes
const sumIcp = T.icps.reduce((a: number, r: any) => a + r.contacted, 0);
const sumCamp = T.campaigns.reduce((a: number, r: any) => a + r.contacted, 0);
console.log(`\n  Σ ICP contacted ${sumIcp} · Σ campaign contacted ${sumCamp} · workspace ${ix.contacted.size}`);
if (sumIcp !== ix.contacted.size) { console.log("  ✗ ICPs no suman"); bad++; }
if (sumCamp !== ix.contacted.size) { console.log("  ✗ campaigns no suman"); bad++; }
console.log(`  team calls ${T.sellerCallsTotal.attempted} · workspace ${T.teamHealth.calls}`);
if (T.sellerCallsTotal.attempted !== T.teamHealth.calls) { console.log("  ✗ calls por seller no suman"); bad++; }
console.log(`  WINDOW ${T.WINDOW_START} → ${T.WINDOW_END} (${T.WINDOW_DAYS} días) · sellerDaily series ${T.sellerDaily[T.sellers[0].name].sent.length}`);
console.log(`  alerts ${T.teamAlerts.length} · insights ${T.sellerInsights.length} · flowDetail ${Object.keys(T.flowDetail).length}`);
console.log(bad === 0 ? "\n  CONTRATO COMPLETO — 0 faltantes\n" : `\n  ${bad} problemas\n`);
process.exit(bad ? 1 : 0);
