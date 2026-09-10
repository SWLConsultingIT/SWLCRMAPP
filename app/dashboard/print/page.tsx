// ─────────────────────────────────────────────────────────────────────────
// The Growth Engine report.
//
// Built from lib/console-data — the SAME aggregation the dashboard renders —
// so the PDF is the screen, not a second report with its own numbers. The
// previous version read the legacy payload and printed the old dashboard's
// layout, so you exported sections that no longer existed on any page.
//
// Whatever filters were active when you pressed Download travel in the URL
// and are stated on the cover. A report that does not say what it is scoped
// to is a report you cannot forward.
// ─────────────────────────────────────────────────────────────────────────

import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, getMyAssignedUserId } from "@/lib/scope";
import { loadConsoleSource, buildIndex, buildOverview, buildTabs, CH_KEYS } from "@/lib/console-data";
import PrintTrigger from "@/app/reports/print/PrintTrigger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ── palette, unchanged: the deck's dark ground and SWL gold ─────────── */
const S = {
  bg: "#0C0E1B", card: "#111728", cardAlt: "#0E1323",
  gold: "#C9A83A", border: "rgba(201,168,58,0.16)",
  w: "#FFFFFF", body: "#BBBDD0", muted: "#6A6A8A",
  good: "#3FBF87", bad: "#E4674F",
};

const T = {
  es: {
    report: "Reporte", dashboard: "Dashboard", engine: "Growth Engine",
    generated: (d: string) => `Generado el ${d}`, allTime: "Todo el período",
    scope: "Alcance", period: "Período", noFilter: "Sin filtros — workspace completo",
    contacted: "Contactados", replied: "Respondieron", positive: "Positivos",
    attempted: "Llamadas intentadas", connected: "Conectadas confirmadas",
    notConnected: "No conectadas", unknown: "Sin outcome", connectRate: "Confirmed connect rate",
    overview: "Resumen", funnelQ: "¿Dónde van los leads?",
    channels: "Canales", replyRate: "Reply rate", sent: "Enviados", reach: "Leads alcanzados",
    icps: "ICPs", campaigns: "Campañas", sellers: "Sellers",
    name: "Nombre", replies: "Replies", rate: "Rate", calls: "Llamadas",
    icpCol: "ICP", enrolled: "Enrolados", queue: "En cola", messages: "Mensajes",
    noData: "Sin actividad en este período",
    unknownNote: (u: number, a: number) => `${u} de ${a} llamadas sin outcome humano — quedan fuera del rate`,
    footer: "Growth AI Engine — SWL Consulting",
  },
  en: {
    report: "Report", dashboard: "Dashboard", engine: "Growth Engine",
    generated: (d: string) => `Generated ${d}`, allTime: "All time",
    scope: "Scope", period: "Period", noFilter: "No filters — whole workspace",
    contacted: "Contacted", replied: "Replied", positive: "Positive",
    attempted: "Calls attempted", connected: "Confirmed connected",
    notConnected: "Not connected", unknown: "Unknown", connectRate: "Confirmed connect rate",
    overview: "Overview", funnelQ: "Where do the leads go?",
    channels: "Channels", replyRate: "Reply rate", sent: "Sent", reach: "Leads reached",
    icps: "ICPs", campaigns: "Campaigns", sellers: "Sellers",
    name: "Name", replies: "Replies", rate: "Rate", calls: "Calls",
    icpCol: "ICP", enrolled: "Enrolled", queue: "Queued", messages: "Messages",
    noData: "No activity in this period",
    unknownNote: (u: number, a: number) => `${u} of ${a} calls have no human outcome — excluded from the rate`,
    footer: "Growth AI Engine — SWL Consulting",
  },
};
type L = typeof T.es;

async function branding() {
  const scope = await getUserScope().catch(() => null);
  const fallback = { companyName: "SWL Consulting", logoUrl: null as string | null, accent: S.gold };
  if (!scope?.companyBioId) return fallback;
  const { data } = await getSupabaseService()
    .from("company_bios").select("company_name, logo_url, primary_color, use_brand_colors")
    .eq("id", scope.companyBioId).maybeSingle();
  return {
    companyName: (data as any)?.company_name ?? fallback.companyName,
    logoUrl: (data as any)?.logo_url ?? null,
    accent: (data as any)?.use_brand_colors && (data as any)?.primary_color ? (data as any).primary_color : S.gold,
  };
}

const n = (v: number) => v.toLocaleString("en-US");
/** A rate with no denominator is "—". Never 0%. */
const rate = (v: number | null) => (v == null ? "—" : `${v}%`);

/* ── print-only primitives ───────────────────────────────────────────── */
function Page({ children }: { children: React.ReactNode }) {
  return <div className="pg">{children}</div>;
}
function H({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: "6mm" }}>
      <div style={{ fontSize: "2.9mm", letterSpacing: "0.16em", textTransform: "uppercase", color: S.gold, fontWeight: 700 }}>{kicker}</div>
      <div style={{ fontSize: "7mm", fontWeight: 700, color: S.w, letterSpacing: "-0.02em", marginTop: "1mm" }}>{title}</div>
    </div>
  );
}
function Stat({ v, l, tone }: { v: string; l: string; tone?: "gold" }) {
  return (
    <div style={{ flex: 1, background: S.card, border: `1px solid ${S.border}`, borderRadius: "2mm", padding: "4mm" }}>
      <div style={{ fontSize: "8mm", fontWeight: 700, color: tone === "gold" ? S.gold : S.w, letterSpacing: "-0.03em", lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: "2.8mm", letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginTop: "2mm" }}>{l}</div>
    </div>
  );
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "3.1mm" }}>
      <thead>
        <tr>{head.map((h, i) => (
          <th key={h} style={{ textAlign: i === 0 ? "left" : "right", color: S.muted, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "2.6mm",
            padding: "2mm 1.5mm", borderBottom: `1px solid ${S.border}` }}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => (
            <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", color: ci === 0 ? S.w : S.body,
              padding: "2mm 1.5mm", borderBottom: `1px solid rgba(255,255,255,0.05)`,
              fontVariantNumeric: "tabular-nums" }}>{c}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}

const day = (d: Date) => new Date(d.getTime() - 180 * 60_000).toISOString().slice(0, 10);

export default async function Page_({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const L: L = one("lang") === "en" ? T.en : T.es;

  const tabs = new Set((one("tabs") ?? "overview,icps,campaigns,channels,sellers").split(",").filter(Boolean));
  const has = (k: string) => tabs.has(k);

  const [scope, assigned, brand] = await Promise.all([
    getUserScope().catch(() => null), getMyAssignedUserId().catch(() => null), branding(),
  ]);
  const bioId = scope?.isScoped ? scope.companyBioId : null;

  const preset = one("preset") ?? "30 days";
  const allTime = preset === "All time";
  const to = allTime ? null : one("to") ?? day(new Date());
  const from = allTime ? null : one("from") ?? day(new Date(Date.now() - 29 * 86_400_000));
  const many = (k: string) => { const v = sp[k]; return v ? (Array.isArray(v) ? v : v.split(",")).filter(Boolean) : undefined; };

  const filters = { from, to, bioId, preset, assignedUserId: assigned,
    campaignNames: many("campaigns"), icpIds: many("icps"), sellerIds: many("sellers") };
  const ix = buildIndex(await loadConsoleSource(bioId), filters);
  const D = buildOverview(ix, filters);
  const K = buildTabs(ix);

  const activeBits = [
    filters.campaignNames?.[0],
    filters.icpIds?.[0] ? D.filters.icps.find(i => i.id === filters.icpIds![0])?.label : null,
    filters.sellerIds?.[0] ? D.filters.sellers.find(s => s.id === filters.sellerIds![0])?.label : null,
  ].filter(Boolean) as string[];

  const h = K.teamHealth;
  const today = new Date().toLocaleDateString(L === T.es ? "es-AR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <PrintTrigger />
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { background: ${S.bg} !important; margin: 0; padding: 0;
          font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
        .pg { width: 210mm; min-height: 297mm; padding: 14mm 16mm 12mm;
          background: ${S.bg}; page-break-after: always; overflow: hidden; }
        .pg:last-of-type { page-break-after: auto; }
        @media print { body { background: ${S.bg} !important; } }
      `}} />

      {/* ══ COVER — what this is, and exactly what it is scoped to ═════ */}
      <Page>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingBottom: "5mm", borderBottom: `1px solid ${S.border}`, marginBottom: "16mm" }}>
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt="" style={{ height: "9mm", objectFit: "contain" }} />
            : <span style={{ fontSize: "7mm", fontWeight: 800, color: brand.accent, letterSpacing: "0.06em" }}>SWL</span>}
          <span style={{ fontSize: "3.2mm", color: S.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {L.engine} · {L.report}
          </span>
        </div>

        <div style={{ fontSize: "3mm", letterSpacing: "0.16em", textTransform: "uppercase", color: brand.accent, fontWeight: 700 }}>
          {brand.companyName}
        </div>
        <div style={{ fontSize: "16mm", fontWeight: 700, color: S.w, letterSpacing: "-0.03em", lineHeight: 1.05, marginTop: "3mm" }}>
          {L.dashboard}
        </div>
        <div style={{ fontSize: "4.2mm", color: S.body, marginTop: "4mm" }}>
          {L.period}: <span style={{ color: S.w, fontWeight: 600 }}>{allTime ? L.allTime : D.period.range}</span>
        </div>
        <div style={{ fontSize: "3.6mm", color: activeBits.length ? S.body : S.muted, marginTop: "2mm" }}>
          {L.scope}: <span style={{ color: activeBits.length ? S.w : S.muted }}>
            {activeBits.length ? activeBits.join(" · ") : L.noFilter}
          </span>
        </div>

        <div style={{ display: "flex", gap: "3mm", marginTop: "14mm" }}>
          <Stat v={n(D.funnel.stages[0].n)} l={L.contacted} />
          <Stat v={n(D.funnel.stages[1].n)} l={L.replied} />
          <Stat v={n(h.calls)} l={L.attempted} />
          <Stat v={rate(h.connectRate)} l={L.connectRate} tone="gold" />
        </div>
        <div style={{ fontSize: "2.9mm", color: S.muted, marginTop: "3mm" }}>
          {L.unknownNote(h.unknown, h.calls)}
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ marginTop: "auto", paddingTop: "14mm", fontSize: "2.9mm", color: S.muted }}>
          {L.generated(today)} · {L.footer}
        </div>
      </Page>

      {/* ══ OVERVIEW ═══════════════════════════════════════════════════ */}
      {has("overview") && (
        <Page>
          <H kicker={L.overview} title={L.funnelQ} />
          <div style={{ display: "flex", gap: "3mm" }}>
            {D.funnel.stages.map(s => <Stat key={s.key} v={n(s.n)} l={s.label} />)}
          </div>

          <div style={{ marginTop: "10mm" }}>
            <H kicker={L.channels} title={L.replyRate} />
            <Table
              head={[L.name, L.sent, L.reach, L.replies, L.rate]}
              rows={D.replyRates.rows.map(r => [r.label, n(r.sent), n(r.reached), n(r.replies), rate(r.rate)])}
            />
          </div>

          <div style={{ marginTop: "10mm" }}>
            <div style={{ display: "flex", gap: "3mm" }}>
              <Stat v={n(h.confirmedConnected)} l={L.connected} />
              <Stat v={n(h.confirmedNotConnected)} l={L.notConnected} />
              <Stat v={n(h.unknown)} l={L.unknown} />
              <Stat v={rate(h.connectRate)} l={L.connectRate} tone="gold" />
            </div>
          </div>
        </Page>
      )}

      {/* ══ ICPs ═══════════════════════════════════════════════════════ */}
      {has("icps") && (
        <Page>
          <H kicker={L.icps} title={L.icps} />
          {K.icps.length === 0 ? <div style={{ color: S.muted, fontSize: "3.2mm" }}>{L.noData}</div> : (
            <Table
              head={[L.icpCol, L.contacted, L.replies, L.rate, L.calls]}
              rows={K.icps.map(r => [r.name, n(r.contacted), n(r.replies), rate(r.rate), n(r.touch.call)])}
            />
          )}
        </Page>
      )}

      {/* ══ CAMPAIGNS ══════════════════════════════════════════════════ */}
      {has("campaigns") && (
        <Page>
          <H kicker={L.campaigns} title={L.campaigns} />
          {K.campaigns.length === 0 ? <div style={{ color: S.muted, fontSize: "3.2mm" }}>{L.noData}</div> : (
            <Table
              head={[L.name, L.enrolled, L.contacted, L.replies, L.rate, L.calls]}
              rows={K.campaigns.map(c => [c.name, n(c.enrolled), n(c.contacted), n(c.replies), rate(c.rate), n(c.calls)])}
            />
          )}
        </Page>
      )}

      {/* ══ CHANNELS ═══════════════════════════════════════════════════ */}
      {has("channels") && (
        <Page>
          <H kicker={L.channels} title={L.channels} />
          <Table
            head={[L.name, L.sent, L.reach, "Result", L.rate]}
            rows={K.channelCards.map(c => [c.label, n(c.sent), n(c.reach), n(c.result), rate(c.rate)])}
          />
          <div style={{ fontSize: "2.9mm", color: S.muted, marginTop: "4mm", lineHeight: 1.6 }}>
            {K.headToHeadNote}
          </div>
        </Page>
      )}

      {/* ══ SELLERS ════════════════════════════════════════════════════ */}
      {has("sellers") && (
        <Page>
          <H kicker={L.sellers} title={L.sellers} />
          {K.sellers.length === 0 ? <div style={{ color: S.muted, fontSize: "3.2mm" }}>{L.noData}</div> : (
            <Table
              head={[L.name, L.contacted, L.messages, L.calls, L.replies, L.rate, L.queue]}
              rows={K.sellers.map(s => [s.name, n(s.contacted), n(s.sent), n(s.calls), n(s.replies), rate(s.replyRate), n(s.queue)])}
            />
          )}
          <div style={{ marginTop: "10mm" }}>
            <H kicker={L.calls} title={L.attempted} />
            <Table
              head={[L.name, L.attempted, L.connected, L.notConnected, L.unknown, L.connectRate]}
              rows={[...K.sellerCalls.map(s => [s.name, n(s.attempted), n(s.connected), n(s.noAnswer), n(s.unclassified), rate(s.connectRate)]),
                     ["TOTAL", n(K.sellerCallsTotal.attempted), n(K.sellerCallsTotal.connected),
                      n(K.sellerCallsTotal.noAnswer), n(K.sellerCallsTotal.unclassified), rate(K.sellerCallsTotal.connectRate)]]}
            />
          </div>
        </Page>
      )}
    </>
  );
}
