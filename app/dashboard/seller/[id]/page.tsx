// Seller drill-down — what they've sent, replies they're getting, their
// active campaigns. Same shell as the campaign / ICP detail pages.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, User, Send, MessageSquare, ThumbsUp, Megaphone } from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";

const gold = "var(--brand, #c9a83a)";

async function loadSellerDetail(sellerId: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const sQ = supabase.from("sellers").select("id, name, active, company_bio_id, shared_with_company_bio_ids").eq("id", sellerId);
  const { data: seller } = bioId
    ? await sQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`).maybeSingle()
    : await sQ.maybeSingle();
  if (!seller) return null;

  const campsQ = supabase.from("campaigns").select("id, name, status, channel, current_step, lead_id, created_at, leads!inner(company_bio_id)").eq("seller_id", sellerId);
  const { data: campsRaw } = bioId
    ? await campsQ.eq("leads.company_bio_id", bioId)
    : await campsQ;
  const camps = (campsRaw ?? []) as any[];
  const campIds = camps.map(c => c.id);
  const leadIds = camps.map(c => c.lead_id).filter(Boolean) as string[];

  const [{ data: msgsRaw }, { data: repliesRaw }] = await Promise.all([
    campIds.length > 0
      ? supabase.from("campaign_messages").select("id, campaign_id, status, sent_at").in("campaign_id", campIds).eq("status", "sent")
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("lead_replies").select("id, lead_id, classification, received_at").in("lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const msgs = (msgsRaw ?? []) as any[];
  const replies = (repliesRaw ?? []) as any[];

  const contactedSet = new Set(leadIds);
  const repliedSet = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveSet = new Set(replies.filter(r => r.classification === "positive" || r.classification === "meeting_intent").map(r => r.lead_id).filter(Boolean) as string[]);

  // Per-campaign breakdown for this seller
  const byCampaign = new Map<string, { name: string; leads: Set<string>; replied: Set<string>; positive: Set<string>; status: string; channel: string }>();
  for (const c of camps) {
    let g = byCampaign.get(c.name);
    if (!g) { g = { name: c.name, leads: new Set(), replied: new Set(), positive: new Set(), status: c.status, channel: c.channel }; byCampaign.set(c.name, g); }
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  const campaignBreakdown = Array.from(byCampaign.values()).map(g => ({
    name: g.name,
    status: g.status,
    channel: g.channel,
    leads: g.leads.size,
    replied: g.replied.size,
    positive: g.positive.size,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.positive - a.positive);

  // 30-day trend
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
  const trendSent = new Array(30).fill(0) as number[];
  const trendReplies = new Array(30).fill(0) as number[];
  const trendPositive = new Array(30).fill(0) as number[];
  for (const m of msgs) {
    if (!m.sent_at) continue;
    const idx = 29 - dayBucket(m.sent_at);
    if (idx >= 0 && idx < 30) trendSent[idx]++;
  }
  for (const r of replies) {
    if (!r.received_at) continue;
    const idx = 29 - dayBucket(r.received_at);
    if (idx >= 0 && idx < 30) {
      trendReplies[idx]++;
      if (r.classification === "positive" || r.classification === "meeting_intent") trendPositive[idx]++;
    }
  }

  return {
    seller,
    totalSent: msgs.length,
    totalContacted: contactedSet.size,
    activeCampaigns: camps.filter(c => c.status === "active").length,
    completedCampaigns: camps.filter(c => c.status === "completed").length,
    repliedCount: repliedSet.size,
    positiveCount: positiveSet.size,
    responseRate: contactedSet.size > 0 ? Math.round((repliedSet.size / contactedSet.size) * 100) : 0,
    conversionRate: contactedSet.size > 0 ? Math.round((positiveSet.size / contactedSet.size) * 100) : 0,
    campaignBreakdown,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
  };
}

export default async function SellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { id } = await params;
  const d = await loadSellerDetail(id);
  if (!d) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}><ArrowLeft size={12} className="inline mr-1" /> Volver al dashboard</Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>No se encontró el seller.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Volver al dashboard
      </Link>

      <PageHero
        icon={User}
        section="Detalle de seller"
        title={d.seller.name}
        description={`${d.activeCampaigns} campañas activas · ${d.totalContacted} leads contactados`}
        accentColor={gold}
        status={{ label: d.seller.active ? "Activo" : "Inactivo", active: d.seller.active }}
      />

      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Mensajes enviados" value={d.totalSent.toLocaleString("es-AR")} icon={Send} accent="#0A66C2" trend={d.trend30d.sent} />
          <KpiCard label="Leads contactados" value={d.totalContacted.toLocaleString("es-AR")} icon={User} accent={gold} />
          <KpiCard label="Respuestas" value={d.repliedCount.toLocaleString("es-AR")} icon={MessageSquare} accent="#7C3AED" trend={d.trend30d.replies} hint={`${d.responseRate}% tasa`} />
          <KpiCard label="Positivas" value={d.positiveCount.toLocaleString("es-AR")} icon={ThumbsUp} accent={C.green} trend={d.trend30d.positive} hint={`${d.conversionRate}% conv`} />
          <KpiCard label="Campañas activas" value={d.activeCampaigns.toLocaleString("es-AR")} icon={Megaphone} accent="#F59E0B" hint={`${d.completedCampaigns} cerradas`} />
        </div>
      </section>

      <section>
        <SectionHeader title="Actividad 30 días" subtitle="Enviados / respuestas / positivas" />
        <Card>
          <MultiLineChart series={[
            { name: "Enviados",   color: "#0A66C2", data: d.trend30d.sent },
            { name: "Respuestas", color: "#7C3AED", data: d.trend30d.replies },
            { name: "Positivas",  color: C.green,   data: d.trend30d.positive },
          ]} />
        </Card>
      </section>

      <section>
        <SectionHeader title="Campañas de este seller" subtitle="Performance por campaña asignada" />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2">Campaña</th>
                  <th className="text-right px-3 py-2">Leads</th>
                  <th className="text-right px-3 py-2">Respond.</th>
                  <th className="text-right px-3 py-2">Positivos</th>
                  <th className="text-right px-3 py-2">Conv.</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.campaignBreakdown.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>Sin campañas asignadas.</td></tr>
                ) : d.campaignBreakdown.map(c => (
                  <tr key={c.name} className="border-t hover:bg-black/[0.02]" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5"><Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="hover:underline font-medium" style={{ color: C.textPrimary }}>{c.name}</Link></td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.leads}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.replied}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums font-semibold" style={{ color: c.positive > 0 ? C.green : C.textMuted }}>{c.positive}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{c.conversionRate}%</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: C.textMuted }}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</h2>
      <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>{children}</div>
  );
}
