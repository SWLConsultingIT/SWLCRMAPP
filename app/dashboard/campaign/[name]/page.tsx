// Campaign drill-down. Reached by clicking a row in the Dashboard's
// campaign comparison table. Shows the same kpis the parent dashboard does
// but scoped to ONE campaign name, plus a per-step funnel (CR → Step 1 →
// Step 2 → …) and a daily activity chart specific to this campaign.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Megaphone, Send, MessageSquare, ThumbsUp, Users, Share2, Mail, Phone, Smartphone, Trophy, Calendar } from "lucide-react";
import { C } from "@/lib/design";
import { getUserScope } from "@/lib/scope";
import { getSupabaseServer } from "@/lib/supabase-server";
import PageHero from "@/components/PageHero";
import KpiCard from "@/components/dashboard/KpiCard";
import MultiLineChart from "@/components/dashboard/MultiLineChart";

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2,     color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,       color: "#059669", label: "Email" },
  call:     { icon: Phone,      color: "#EA580C", label: "Llamadas" },
  whatsapp: { icon: Smartphone, color: "#25D366", label: "WhatsApp" },
};

async function loadCampaignDetail(name: string) {
  const supabase = await getSupabaseServer();
  const scope = await getUserScope();
  const bioId = scope.isScoped ? scope.companyBioId! : null;

  const campsQ = supabase.from("campaigns")
    .select("id, name, status, channel, current_step, sequence_steps, lead_id, seller_id, created_at, started_at, completed_at, stop_reason, paused_until, leads!inner(id, primary_first_name, primary_last_name, company_name, status, icp_profile_id, company_bio_id)")
    .eq("name", name);

  const { data: campRaw } = bioId
    ? await campsQ.eq("leads.company_bio_id", bioId)
    : await campsQ;
  const camps = (campRaw ?? []) as any[];

  if (camps.length === 0) return null;

  const campIds = camps.map(c => c.id);
  const leadIds = camps.map(c => c.lead_id).filter(Boolean) as string[];
  const sellerIds = Array.from(new Set(camps.map(c => c.seller_id).filter(Boolean) as string[]));
  const icpIds = Array.from(new Set(camps.map(c => (c.leads as any)?.icp_profile_id).filter(Boolean) as string[]));

  const [{ data: msgsRaw }, { data: repliesRaw }, { data: sellersRaw }, { data: icpsRaw }] = await Promise.all([
    supabase.from("campaign_messages").select("id, campaign_id, step_number, status, sent_at, channel").in("campaign_id", campIds),
    supabase.from("lead_replies").select("id, lead_id, campaign_id, classification, channel, received_at").in("campaign_id", campIds),
    sellerIds.length > 0
      ? supabase.from("sellers").select("id, name").in("id", sellerIds)
      : Promise.resolve({ data: [] as any[] }),
    icpIds.length > 0
      ? supabase.from("icp_profiles").select("id, profile_name").in("id", icpIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const msgs = (msgsRaw ?? []) as any[];
  const replies = (repliesRaw ?? []) as any[];
  const sellerMap = new Map<string, string>();
  for (const s of (sellersRaw ?? []) as any[]) sellerMap.set(s.id, s.name);
  const icpMap = new Map<string, string>();
  for (const i of (icpsRaw ?? []) as any[]) icpMap.set(i.id, i.profile_name);

  // Aggregate
  const repliedLeadIds = new Set(replies.map(r => r.lead_id).filter(Boolean) as string[]);
  const positiveLeadIds = new Set(replies.filter(r => r.classification === "positive" || r.classification === "meeting_intent").map(r => r.lead_id).filter(Boolean) as string[]);
  const negativeLeadIds = new Set(replies.filter(r => r.classification === "negative" || r.classification === "not_now" || r.classification === "unsubscribe").map(r => r.lead_id).filter(Boolean) as string[]);
  const meetingLeadIds = new Set(camps.filter(c => (c.leads as any)?.status === "qualified").map(c => c.lead_id).filter(Boolean) as string[]);
  const wonLeadIds = new Set(camps.filter(c => (c.leads as any)?.status === "closed_won").map(c => c.lead_id).filter(Boolean) as string[]);

  const sentMsgs = msgs.filter(m => m.status === "sent");
  const totalSent = sentMsgs.length;
  const totalLeads = camps.length;
  const repliedCount = repliedLeadIds.size;
  const positiveCount = positiveLeadIds.size;
  const negativeCount = negativeLeadIds.size;
  const meetingCount = meetingLeadIds.size;
  const wonCount = wonLeadIds.size;

  // Per-step funnel from sent campaign_messages: step_number 0 = CR, 1..N = followups
  const stepCounts: Record<number, number> = {};
  for (const m of sentMsgs) {
    const step = m.step_number ?? 0;
    if (step >= 0 && step < 20) stepCounts[step] = (stepCounts[step] ?? 0) + 1;
  }

  // Sequence definition from the first campaign (all share the same template)
  const sequenceSteps: { channel: string; daysAfter: number }[] = Array.isArray(camps[0].sequence_steps) ? (camps[0].sequence_steps as any[]) : [];

  // 30-day daily trend
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dayBucket = (iso: string) => Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
  const trendSent = new Array(30).fill(0) as number[];
  const trendReplies = new Array(30).fill(0) as number[];
  const trendPositive = new Array(30).fill(0) as number[];
  for (const m of sentMsgs) {
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

  // Status mix
  const statusMix = camps.reduce<Record<string, number>>((acc, c) => {
    const s = c.status ?? "unknown";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  // Per-seller breakdown within this campaign
  const sellerStats = new Map<string, { name: string; leads: number; sent: number; replied: number; positive: number }>();
  for (const c of camps) {
    if (!c.seller_id) continue;
    let s = sellerStats.get(c.seller_id);
    if (!s) { s = { name: sellerMap.get(c.seller_id) ?? "Sin asignar", leads: 0, sent: 0, replied: 0, positive: 0 }; sellerStats.set(c.seller_id, s); }
    s.leads++;
    if (c.lead_id && repliedLeadIds.has(c.lead_id)) s.replied++;
    if (c.lead_id && positiveLeadIds.has(c.lead_id)) s.positive++;
  }
  const sellerById = new Map<string, string>();
  for (const c of camps) if (c.seller_id) sellerById.set(c.id, c.seller_id);
  for (const m of sentMsgs) {
    const sid = sellerById.get(m.campaign_id);
    if (sid && sellerStats.has(sid)) sellerStats.get(sid)!.sent++;
  }

  // Lead drilldown — show top 10 most engaged (replied first, then positive)
  const leadDetail = camps.map(c => {
    const l = c.leads as any;
    return {
      campaignId: c.id,
      leadId: c.lead_id,
      name: `${l?.primary_first_name ?? ""} ${l?.primary_last_name ?? ""}`.trim() || "—",
      company: l?.company_name ?? null,
      step: c.current_step ?? 0,
      status: c.status,
      replied: c.lead_id ? repliedLeadIds.has(c.lead_id) : false,
      positive: c.lead_id ? positiveLeadIds.has(c.lead_id) : false,
      negative: c.lead_id ? negativeLeadIds.has(c.lead_id) : false,
      seller: c.seller_id ? sellerMap.get(c.seller_id) ?? null : null,
    };
  }).sort((a, b) => (b.positive ? 2 : 0) - (a.positive ? 2 : 0) + ((b.replied ? 1 : 0) - (a.replied ? 1 : 0)) || b.step - a.step);

  return {
    name,
    totalLeads,
    totalSent,
    repliedCount,
    positiveCount,
    negativeCount,
    meetingCount,
    wonCount,
    responseRate: totalLeads > 0 ? Math.round((repliedCount / totalLeads) * 100) : 0,
    positiveRate: repliedCount > 0 ? Math.round((positiveCount / repliedCount) * 100) : 0,
    conversionRate: totalLeads > 0 ? Math.round((positiveCount / totalLeads) * 100) : 0,
    statusMix,
    channels: Array.from(new Set(camps.map(c => c.channel).filter(Boolean) as string[])),
    icpNames: icpIds.map(id => icpMap.get(id) ?? "Sin ICP"),
    sellers: Array.from(sellerStats.values()).sort((a, b) => b.positive - a.positive),
    sequenceSteps,
    stepCounts,
    trend30d: { sent: trendSent, replies: trendReplies, positive: trendPositive },
    leadDetail: leadDetail.slice(0, 15),
    startedAt: camps[0].started_at ?? camps[0].created_at,
    completedAt: camps.find(c => c.status === "completed")?.completed_at ?? null,
    stopReason: camps.find(c => c.stop_reason)?.stop_reason ?? null,
  };
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const scope = await getUserScope();
  if (scope.userId && scope.tier !== "super_admin" && !scope.companyBioId) redirect("/onboarding");

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const detail = await loadCampaignDetail(name);

  if (!detail) {
    return (
      <div className="p-6">
        <Link href="/" className="text-xs hover:underline" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} className="inline mr-1" /> Volver al dashboard
        </Link>
        <p className="mt-4 text-sm" style={{ color: C.textBody }}>No se encontró la campaña.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Volver al dashboard
      </Link>

      <PageHero
        icon={Megaphone}
        section="Detalle de campaña"
        title={detail.name}
        description={`${detail.totalLeads} leads · ${detail.channels.map(ch => channelMeta[ch]?.label ?? ch).join(" + ")} ${detail.icpNames.length > 0 ? `· ICP: ${detail.icpNames.join(", ")}` : ""}`}
        accentColor={gold}
        status={{
          label: detail.statusMix.active ? `${detail.statusMix.active} activas` : detail.statusMix.completed ? "Cerrada" : "Pausada",
          active: !!detail.statusMix.active,
        }}
      />

      {/* KPI cards specific to this campaign */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Leads" value={detail.totalLeads.toLocaleString("es-AR")} icon={Users} accent={gold} />
          <KpiCard label="Mensajes enviados" value={detail.totalSent.toLocaleString("es-AR")} icon={Send} accent="#0A66C2" trend={detail.trend30d.sent} />
          <KpiCard label="Respuestas" value={detail.repliedCount.toLocaleString("es-AR")} icon={MessageSquare} accent="#7C3AED" trend={detail.trend30d.replies} hint={`${detail.responseRate}% tasa`} />
          <KpiCard label="Positivas" value={detail.positiveCount.toLocaleString("es-AR")} icon={ThumbsUp} accent={C.green} trend={detail.trend30d.positive} hint={`${detail.positiveRate}% de respuestas`} />
          <KpiCard label="Reuniones" value={detail.meetingCount.toLocaleString("es-AR")} icon={Calendar} accent="#F59E0B" />
          <KpiCard label="Ganados" value={detail.wonCount.toLocaleString("es-AR")} icon={Trophy} accent="#DC2626" />
        </div>
      </section>

      {/* Per-step funnel + 30d trend */}
      <section>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Embudo por paso" subtitle="Cuántos leads llegaron a cada step">
            <StepFunnel sequence={detail.sequenceSteps} stepCounts={detail.stepCounts} totalLeads={detail.totalLeads} />
          </Card>
          <Card title="Actividad 30 días" subtitle="Mensajes y respuestas por día">
            <MultiLineChart series={[
              { name: "Enviados",   color: "#0A66C2", data: detail.trend30d.sent },
              { name: "Respuestas", color: "#7C3AED", data: detail.trend30d.replies },
              { name: "Positivas",  color: C.green,   data: detail.trend30d.positive },
            ]} />
          </Card>
        </div>
      </section>

      {/* Sellers within this campaign */}
      {detail.sellers.length > 0 && (
        <section>
          <SectionHeader title="Por seller en esta campaña" subtitle="Distribución de leads y resultados" />
          <Card title={null} subtitle={null}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                    <th className="text-left px-4 py-2">Seller</th>
                    <th className="text-right px-3 py-2">Leads</th>
                    <th className="text-right px-3 py-2">Enviados</th>
                    <th className="text-right px-3 py-2">Respond.</th>
                    <th className="text-right px-3 py-2">Positivos</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sellers.map((s, idx) => (
                    <tr key={idx} className="border-t" style={{ borderColor: C.border }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: C.textPrimary }}>{s.name}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.leads}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.sent}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{s.replied}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums font-semibold" style={{ color: s.positive > 0 ? C.green : C.textMuted }}>{s.positive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      {/* Lead-level engagement */}
      <section>
        <SectionHeader title="Leads más enganchados" subtitle="Top 15 ordenados por respuesta + paso actual" />
        <Card title={null} subtitle={null}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2">Lead</th>
                  <th className="text-left px-3 py-2">Empresa</th>
                  <th className="text-left px-3 py-2">Seller</th>
                  <th className="text-right px-3 py-2">Paso</th>
                  <th className="text-center px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {detail.leadDetail.map(l => (
                  <tr key={l.campaignId} className="border-t hover:bg-black/[0.02]" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5">
                      {l.leadId ? <Link href={`/leads/${l.leadId}`} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{l.name}</Link> : <span style={{ color: C.textMuted }}>{l.name}</span>}
                    </td>
                    <td className="px-3 py-2.5" style={{ color: C.textMuted }}>{l.company ?? "—"}</td>
                    <td className="px-3 py-2.5" style={{ color: C.textMuted }}>{l.seller ?? "—"}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: C.textBody }}>{l.step}</td>
                    <td className="text-center px-3 py-2.5">
                      {l.positive ? <PillBadge color={C.green}>Positivo</PillBadge> : l.negative ? <PillBadge color={C.red}>Negativo</PillBadge> : l.replied ? <PillBadge color="#7C3AED">Respondió</PillBadge> : <PillBadge color={C.textMuted}>En flow</PillBadge>}
                    </td>
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
      <h2 className="text-base font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>{title}</h2>
      <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string | null; subtitle: string | null; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {(title || subtitle) && (
        <div className="px-5 py-3 border-b" style={{ borderColor: C.border }}>
          {title && <p className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{title}</p>}
          {subtitle && <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function PillBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {children}
    </span>
  );
}

function StepFunnel({
  sequence,
  stepCounts,
  totalLeads,
}: {
  sequence: { channel: string; daysAfter: number }[];
  stepCounts: Record<number, number>;
  totalLeads: number;
}) {
  // Rows: step 0 (CR) first if there's LinkedIn in the sequence + we have any step 0 sent,
  // then sequence positions 1..N labelled by their channel.
  const rows: { label: string; channel: string; count: number; idx: number }[] = [];
  const hasCR = sequence.length > 0 && (sequence[0]?.channel === "linkedin" && sequence[0]?.daysAfter === 0);
  if (stepCounts[0] || hasCR) {
    rows.push({ label: "Connection Request", channel: "linkedin", count: stepCounts[0] ?? 0, idx: 0 });
  }
  // Use sequence to label per-step (if available), fall back to channel labels
  const followups = hasCR ? sequence.slice(1) : sequence;
  for (let i = 0; i < followups.length; i++) {
    const stepNum = i + 1;
    const ch = followups[i]?.channel ?? "—";
    rows.push({ label: `Step ${stepNum} · ${channelMeta[ch]?.label ?? ch}`, channel: ch, count: stepCounts[stepNum] ?? 0, idx: stepNum });
  }

  const top = Math.max(totalLeads, ...rows.map(r => r.count), 1);
  return (
    <div className="space-y-2">
      {rows.map(r => {
        const widthPct = top > 0 ? Math.max(8, Math.round((r.count / top) * 100)) : 8;
        const color = channelMeta[r.channel]?.color ?? "#6B7280";
        return (
          <div key={r.idx} className="flex items-center gap-3">
            <div className="w-44 shrink-0 text-right">
              <p className="text-xs font-semibold" style={{ color: C.textBody }}>{r.label}</p>
            </div>
            <div className="flex-1 relative h-9 rounded-lg overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${color} 6%, ${C.surface})` }}>
              <div className="absolute inset-y-0 left-0 flex items-center px-3 rounded-lg"
                style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 78%, white))`, minWidth: 80 }}>
                <span className="text-xs font-bold tabular-nums" style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}>
                  {r.count.toLocaleString("es-AR")}
                </span>
              </div>
            </div>
            <div className="w-16 shrink-0 text-right">
              <p className="text-[10px]" style={{ color: C.textDim }}>
                {totalLeads > 0 ? Math.round((r.count / totalLeads) * 100) : 0}%
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
