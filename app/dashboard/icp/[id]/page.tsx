// ICP drill-down — leads in this ICP, campaigns running against it, and the
// performance metrics for that segment.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Target, Users, Send, MessageSquare, ThumbsUp } from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";

const gold = "var(--brand, #c9a83a)";

async function loadIcpDetail(icpId: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const profileQ = supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles, pain_points, solutions_offered, company_bio_id").eq("id", icpId);
  const { data: prof } = bioId
    ? await profileQ.eq("company_bio_id", bioId).maybeSingle()
    : await profileQ.maybeSingle();
  if (!prof) return null;

  const { data: leadsRaw } = await supabase.from("leads")
    .select("id, status, lead_score, company_name, primary_first_name, primary_last_name, created_at")
    .eq("icp_profile_id", icpId)
    .order("lead_score", { ascending: false });
  const leads = (leadsRaw ?? []) as any[];
  const leadIds = leads.map(l => l.id);

  const [{ data: campsRaw }, { data: repliesRaw }, { data: msgsRaw }] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("campaigns").select("id, name, status, channel, lead_id, current_step").in("lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("lead_replies").select("id, lead_id, classification, received_at").in("lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
    leadIds.length > 0
      ? supabase.from("campaign_messages").select("id, status, sent_at, campaign_id, campaigns!inner(lead_id)").eq("status", "sent").in("campaigns.lead_id", leadIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const camps = (campsRaw ?? []) as any[];
  const replies = (repliesRaw ?? []) as any[];
  const msgs = (msgsRaw ?? []) as any[];

  const contactedSet = new Set(camps.map(c => c.lead_id).filter(Boolean) as string[]);
  const repliedSet = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveSet = new Set(replies.filter(r => r.classification === "positive" || r.classification === "meeting_intent").map(r => r.lead_id).filter(Boolean) as string[]);

  // Per-campaign breakdown within this ICP
  const byCampaign = new Map<string, { name: string; leads: Set<string>; replied: Set<string>; positive: Set<string>; status: string }>();
  for (const c of camps) {
    let g = byCampaign.get(c.name);
    if (!g) { g = { name: c.name, leads: new Set(), replied: new Set(), positive: new Set(), status: c.status }; byCampaign.set(c.name, g); }
    if (c.lead_id) {
      g.leads.add(c.lead_id);
      if (repliedSet.has(c.lead_id)) g.replied.add(c.lead_id);
      if (positiveSet.has(c.lead_id)) g.positive.add(c.lead_id);
    }
  }
  const campaignBreakdown = Array.from(byCampaign.values()).map(g => ({
    name: g.name,
    status: g.status,
    leads: g.leads.size,
    replied: g.replied.size,
    positive: g.positive.size,
    conversionRate: g.leads.size > 0 ? Math.round((g.positive.size / g.leads.size) * 100) : 0,
  })).sort((a, b) => b.conversionRate - a.conversionRate);

  // 30-day trends
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
    profile: prof,
    totalLeads: leads.length,
    contactedCount: contactedSet.size,
    repliedCount: repliedSet.size,
    positiveCount: positiveSet.size,
    responseRate: contactedSet.size > 0 ? Math.round((repliedSet.size / contactedSet.size) * 100) : 0,
    conversionRate: contactedSet.size > 0 ? Math.round((positiveSet.size / contactedSet.size) * 100) : 0,
    campaignBreakdown,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    topLeads: leads.slice(0, 15),
  };
}

export default async function IcpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { id } = await params;
  const d = await loadIcpDetail(id);
  if (!d) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}><ArrowLeft size={12} className="inline mr-1" /> Volver al dashboard</Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>No se encontró el ICP.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Volver al dashboard
      </Link>

      <PageHero
        icon={Target}
        section="Detalle de ICP"
        title={d.profile.profile_name}
        description={`${d.totalLeads} leads · ${d.contactedCount} contactados`}
        accentColor={gold}
      />

      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Leads" value={d.totalLeads.toLocaleString("es-AR")} icon={Users} accent={gold} />
          <KpiCard label="Contactados" value={d.contactedCount.toLocaleString("es-AR")} icon={Send} accent="#0A66C2" trend={d.trend30d.sent} />
          <KpiCard label="Respuestas" value={d.repliedCount.toLocaleString("es-AR")} icon={MessageSquare} accent="#7C3AED" trend={d.trend30d.replies} hint={`${d.responseRate}% tasa`} />
          <KpiCard label="Positivas" value={d.positiveCount.toLocaleString("es-AR")} icon={ThumbsUp} accent={C.green} trend={d.trend30d.positive} />
          <KpiCard label="Conversión" value={`${d.conversionRate}%`} icon={Target} accent="#F59E0B" />
        </div>
      </section>

      <section>
        <SectionHeader title="Actividad 30 días" subtitle="Enviados / respuestas / positivas para este ICP" />
        <Card>
          <MultiLineChart series={[
            { name: "Enviados",   color: "#0A66C2", data: d.trend30d.sent },
            { name: "Respuestas", color: "#7C3AED", data: d.trend30d.replies },
            { name: "Positivas",  color: C.green,   data: d.trend30d.positive },
          ]} />
        </Card>
      </section>

      {d.campaignBreakdown.length > 0 && (
        <section>
          <SectionHeader title="Campañas contra este ICP" subtitle="Comparativo de performance" />
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
                  {d.campaignBreakdown.map(c => (
                    <tr key={c.name} className="border-t" style={{ borderColor: C.border }}>
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/campaign/${encodeURIComponent(c.name)}`} className="hover:underline font-medium" style={{ color: C.textPrimary }}>{c.name}</Link>
                      </td>
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
      )}

      <section>
        <SectionHeader title="Leads top" subtitle="Los 15 con mejor lead_score en este ICP" />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2">Lead</th>
                  <th className="text-left px-3 py-2">Empresa</th>
                  <th className="text-right px-3 py-2">Score</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.topLeads.map((l: any) => (
                  <tr key={l.id} className="border-t hover:bg-black/[0.02]" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5"><Link href={`/leads/${l.id}`} className="hover:underline font-medium" style={{ color: C.textPrimary }}>{`${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "—"}</Link></td>
                    <td className="px-3 py-2.5" style={{ color: C.textMuted }}>{l.company_name ?? "—"}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{l.lead_score ?? 0}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: C.textMuted }}>{l.status ?? "—"}</td>
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
