import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ExternalLink, Mail, Phone, MessageCircle, Link2,
  CheckCircle, XCircle, Clock, MinusCircle, Send, MessageSquare,
  Building2, Briefcase, User, TrendingUp, Calendar, StickyNote,
} from "lucide-react";
import AddNoteForm from "@/components/AddNoteForm";
import CampaignActions from "@/components/CampaignActions";

async function getLead(id: string) {
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();
  return data;
}

async function getCampaigns(leadId: string) {
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, channel, current_step, sequence_steps, channel_msg_index, last_step_at, paused_until, completed_at, created_at, sellers(name, email)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function getMessages(campaignIds: string[]) {
  if (!campaignIds.length) return [];
  const { data } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, message_number, channel, content, sent_at, created_at")
    .in("campaign_id", campaignIds)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function getReplies(leadId: string) {
  const { data } = await supabase
    .from("lead_replies")
    .select("id, campaign_id, message, classification, received_at, created_at")
    .eq("lead_id", leadId)
    .order("received_at", { ascending: true });
  return data ?? [];
}

async function getNotes(leadId: string) {
  try {
    const { data } = await supabase
      .from("lead_notes")
      .select("id, content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    return data ?? [];
  } catch {
    return [];
  }
}

type TimelineEvent = {
  at: string;
  type: "created" | "campaign_start" | "message_sent" | "reply" | "status_change" | "campaign_end" | "note";
  label: string;
  body?: string;
  meta?: string;
  classification?: string;
  channel?: string;
};

const classStyle: Record<string, { color: string; bg: string; label: string }> = {
  positive: { color: C.green,  bg: C.greenGlow,  label: "Positivo" },
  negative: { color: C.red,    bg: C.redGlow,    label: "Negativo" },
  ambiguous:{ color: C.yellow, bg: C.yellowGlow, label: "Ambiguo" },
};

const channelLabel: Record<string, string> = {
  linkedin: "LinkedIn", email: "Email", whatsapp: "WhatsApp", call: "Call",
};
const channelColor: Record<string, string> = {
  linkedin: C.cyan, email: C.green, whatsapp: "#22c55e", call: C.gold,
};

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  new:         { label: "Nuevo",      color: C.cyan,     bg: C.cyanGlow,   icon: Clock },
  contacted:   { label: "Contactado", color: C.gold,     bg: C.goldGlow,   icon: Clock },
  qualified:   { label: "Calificado", color: C.green,    bg: C.greenGlow,  icon: CheckCircle },
  cold:        { label: "Cold",       color: C.textBody, bg: "rgba(78,90,114,0.08)", icon: MinusCircle },
  closed_lost: { label: "Perdido",    color: C.red,      bg: C.redGlow,    icon: XCircle },
};

function TimelineDot({ type, classification }: { type: TimelineEvent["type"]; classification?: string }) {
  if (type === "reply") {
    const cs = classStyle[classification ?? "ambiguous"] ?? classStyle.ambiguous;
    return <div className="w-3 h-3 rounded-full border-2 shrink-0" style={{ backgroundColor: cs.color, borderColor: cs.color, boxShadow: `0 0 8px ${cs.color}60` }} />;
  }
  if (type === "message_sent") return <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: C.gold, boxShadow: `0 0 6px ${C.gold}40` }} />;
  if (type === "campaign_start") return <div className="w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: C.cyan, backgroundColor: "transparent" }} />;
  if (type === "campaign_end") return <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: C.textMuted }} />;
  if (type === "created") return <div className="w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: C.gold, backgroundColor: C.goldGlow }} />;
  if (type === "note") return <div className="w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: C.yellow, backgroundColor: C.yellowGlow }} />;
  return <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: C.textDim }} />;
}

function fmt(d: string) {
  return new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, campaigns] = await Promise.all([getLead(id), getCampaigns(id)]);
  if (!lead) notFound();

  const campaignIds = campaigns.map((c: any) => c.id);
  const [messages, replies, notes] = await Promise.all([getMessages(campaignIds), getReplies(id), getNotes(id)]);

  // Build unified timeline
  const timeline: TimelineEvent[] = [];

  timeline.push({ at: lead.created_at, type: "created", label: "Lead creado", meta: "Importado al CRM" });

  for (const c of campaigns as any[]) {
    timeline.push({
      at: c.created_at, type: "campaign_start",
      label: `Campaña iniciada — ${channelLabel[c.channel] ?? c.channel}`,
      meta: `Seller: ${c.sellers?.name ?? "—"}`,
      channel: c.channel,
    });

    const campMsgs = messages.filter((m: any) => m.campaign_id === c.id);
    for (const m of campMsgs as any[]) {
      if (m.sent_at) {
        timeline.push({
          at: m.sent_at, type: "message_sent",
          label: `Mensaje #${m.message_number} enviado`,
          body: m.content,
          channel: m.channel ?? c.channel,
        });
      }
    }

    if (c.completed_at) {
      timeline.push({ at: c.completed_at, type: "campaign_end", label: "Campaña completada", meta: c.status });
    }
  }

  for (const r of replies as any[]) {
    const cs = classStyle[r.classification] ?? classStyle.ambiguous;
    timeline.push({
      at: r.received_at, type: "reply",
      label: `Respuesta recibida — ${cs.label}`,
      body: r.message,
      classification: r.classification,
    });
  }

  for (const n of notes as any[]) {
    timeline.push({ at: n.created_at, type: "note", label: "Nota interna", body: n.content });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const st = statusConfig[lead.status] ?? statusConfig.new;
  const StatusIcon = st.icon;

  const sentCount = messages.filter((m: any) => m.sent_at).length;
  const replyCount = replies.length;
  const positiveReplies = replies.filter((r: any) => r.classification === "positive").length;

  return (
    <div className="p-8 max-w-6xl fade-in">
      {/* Back */}
      <Link href="/leads" className="inline-flex items-center gap-2 text-sm mb-6 transition-colors"
        style={{ color: C.textMuted }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.color = C.textBody}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = C.textMuted}>
        <ArrowLeft size={14} />
        Volver a Leads
      </Link>

      {/* Header card */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${C.gold}, #e8c84a)`, color: "#0a0d14" }}>
              {lead.first_name?.[0]}{lead.last_name?.[0]}
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>
                {lead.first_name} {lead.last_name}
              </h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {lead.role && (
                  <span className="flex items-center gap-1 text-sm" style={{ color: C.textBody }}>
                    <Briefcase size={12} /> {lead.role}
                  </span>
                )}
                {lead.company && (
                  <span className="flex items-center gap-1 text-sm" style={{ color: C.textBody }}>
                    <Building2 size={12} /> {lead.company}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2">
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1 text-xs transition-colors"
                    style={{ color: C.textMuted }}>
                    <Mail size={11} /> {lead.email}
                  </a>
                )}
                {lead.linkedin_url && (
                  <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs"
                    style={{ color: C.cyan }}>
                    <ExternalLink size={11} /> Ver en LinkedIn
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            {/* Status badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{ backgroundColor: st.bg, borderColor: `${st.color}30` }}>
              <StatusIcon size={13} style={{ color: st.color }} />
              <span className="text-sm font-semibold" style={{ color: st.color }}>{st.label}</span>
            </div>
            {/* Seller */}
            {lead.assigned_seller && (
              <div className="flex items-center gap-1.5 text-sm" style={{ color: C.textBody }}>
                <User size={12} style={{ color: C.gold }} />
                {lead.assigned_seller}
              </div>
            )}
            {/* Odoo link */}
            {lead.odoo_lead_id && (
              <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
                style={{ backgroundColor: C.greenGlow, color: C.green }}>
                <TrendingUp size={11} />
                Odoo #{lead.odoo_lead_id}
              </div>
            )}
          </div>
        </div>

        {/* Channels + stats row */}
        <div className="mt-5 pt-4 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-4">
            <span className="text-xs" style={{ color: C.textMuted }}>Canales:</span>
            <div className="flex items-center gap-3">
              {[
                { icon: Link2,         key: "allow_linkedin", label: "LinkedIn",  color: C.cyan },
                { icon: Mail,          key: "allow_email",    label: "Email",     color: C.green },
                { icon: MessageCircle, key: "allow_whatsapp", label: "WhatsApp",  color: "#22c55e" },
                { icon: Phone,         key: "allow_call",     label: "Call",      color: C.gold },
              ].map(({ icon: Icon, key, label, color }) => (
                <div key={key} className="flex items-center gap-1.5 text-xs"
                  style={{ color: lead[key] ? color : C.textDim, opacity: lead[key] ? 1 : 0.4 }}>
                  <Icon size={13} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-6">
            {[
              { label: "Mensajes enviados", value: sentCount, color: C.gold },
              { label: "Respuestas",        value: replyCount, color: C.cyan },
              { label: "Positivas",         value: positiveReplies, color: C.green },
              { label: "Campañas",          value: campaigns.length, color: C.textBody },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-xl font-bold" style={{ color }}>{value}</p>
                <p className="text-xs" style={{ color: C.textMuted }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="col-span-2">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: C.textPrimary }}>
            <Calendar size={14} style={{ color: C.gold }} />
            Timeline completo
          </h2>

          {timeline.length === 0 ? (
            <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <p style={{ color: C.textDim }}>Sin actividad registrada</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-1.5 top-3 bottom-3 w-px" style={{ backgroundColor: C.border }} />

              <div className="space-y-1">
                {timeline.map((ev, i) => {
                  const cs = ev.classification ? classStyle[ev.classification] : null;
                  return (
                    <div key={i} className="relative pl-8">
                      {/* Dot */}
                      <div className="absolute left-0 top-3">
                        <TimelineDot type={ev.type} classification={ev.classification} />
                      </div>

                      <div className="rounded-lg border p-3.5 mb-2 transition-colors"
                        style={{
                          backgroundColor: ev.type === "reply" ? (cs?.bg ?? C.card) : ev.type === "message_sent" ? C.goldGlow : ev.type === "note" ? C.yellowGlow : C.card,
                          borderColor: ev.type === "reply" ? `${cs?.color}25` : ev.type === "note" ? `${C.yellow}25` : C.border,
                        }}>
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium" style={{ color: C.textPrimary }}>{ev.label}</span>
                            {ev.channel && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{ backgroundColor: `${channelColor[ev.channel]}15`, color: channelColor[ev.channel] }}>
                                {channelLabel[ev.channel] ?? ev.channel}
                              </span>
                            )}
                            {ev.classification && cs && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                                style={{ backgroundColor: cs.bg, color: cs.color }}>
                                {cs.label}
                              </span>
                            )}
                          </div>
                          <span className="text-xs shrink-0 tabular-nums" style={{ color: C.textMuted }}>
                            {fmt(ev.at)}
                          </span>
                        </div>
                        {ev.meta && (
                          <p className="text-xs" style={{ color: C.textMuted }}>{ev.meta}</p>
                        )}
                        {ev.body && (
                          <div className="mt-2 p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ backgroundColor: C.surface, color: C.textBody, borderLeft: `2px solid ${ev.type === "reply" ? (cs?.color ?? C.textMuted) : C.gold}` }}>
                            {ev.body}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column: campaigns + messages summary */}
        <div className="space-y-4">
          {/* Campaigns */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: C.textPrimary }}>
              <Send size={13} style={{ color: C.gold }} />
              Campañas ({campaigns.length})
            </h2>
            <div className="space-y-2">
              {(campaigns as any[]).map((c) => {
                const total = c.sequence_steps?.length ?? 0;
                const pct = total > 0 ? Math.round((c.current_step / total) * 100) : 0;
                const statusColors: Record<string, string> = {
                  active: C.green, paused: C.yellow, completed: C.textMuted, failed: C.red
                };
                const color = statusColors[c.status] ?? C.textMuted;
                return (
                  <div key={c.id} className="rounded-lg border p-3"
                    style={{ backgroundColor: C.card, borderColor: C.border }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold capitalize" style={{ color: channelColor[c.channel] ?? C.textBody }}>
                        {channelLabel[c.channel] ?? c.channel}
                      </span>
                      <span className="text-xs font-medium" style={{ color }}>{c.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.gold}, #e8c84a)` }} />
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{c.current_step}/{total}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div>
                        {c.sellers?.name && (
                          <p className="text-xs" style={{ color: C.textMuted }}>Seller: {c.sellers.name}</p>
                        )}
                        {c.paused_until && (
                          <p className="text-xs mt-0.5" style={{ color: C.yellow }}>Pausada hasta {fmtDate(c.paused_until)}</p>
                        )}
                      </div>
                      <CampaignActions campaignId={c.id} status={c.status} />
                    </div>
                  </div>
                );
              })}
              {campaigns.length === 0 && (
                <p className="text-sm" style={{ color: C.textDim }}>Sin campañas</p>
              )}
            </div>
          </div>

          {/* Replies summary */}
          {replies.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: C.textPrimary }}>
                <MessageSquare size={13} style={{ color: C.cyan }} />
                Respuestas ({replies.length})
              </h2>
              <div className="space-y-2">
                {(replies as any[]).map((r) => {
                  const cs = classStyle[r.classification] ?? classStyle.ambiguous;
                  return (
                    <div key={r.id} className="rounded-lg border p-3"
                      style={{ backgroundColor: cs.bg, borderColor: `${cs.color}20` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold" style={{ color: cs.color }}>{cs.label}</span>
                        <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>
                          {fmt(r.received_at)}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{r.message}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add note */}
          <AddNoteForm leadId={id} />

          {/* Lead data */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: C.textPrimary }}>
              <StickyNote size={13} style={{ color: C.textMuted }} />
              Datos del lead
            </h2>
            <div className="rounded-xl border divide-y" style={{ backgroundColor: C.card, borderColor: C.border }}>
              {[
                { label: "Industria", value: lead.industry },
                { label: "LinkedIn", value: lead.linkedin_url, link: lead.linkedin_url },
                { label: "Secuencia", value: lead.n8n_flow },
                { label: "Creado", value: lead.created_at ? fmtDate(lead.created_at) : null },
                { label: "Actualizado", value: lead.updated_at ? fmtDate(lead.updated_at) : null },
              ].filter(f => f.value).map(({ label, value, link }) => (
                <div key={label} className="flex items-start justify-between gap-3 px-3 py-2.5" style={{ borderColor: C.border }}>
                  <span className="text-xs shrink-0" style={{ color: C.textMuted }}>{label}</span>
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-right truncate max-w-40" style={{ color: C.cyan }}>
                      {value}
                    </a>
                  ) : (
                    <span className="text-xs text-right" style={{ color: C.textBody }}>{value}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
