import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, AlertTriangle, CheckCircle, PauseCircle,
  TrendingUp, Send, MessageSquare, Users, Clock,
} from "lucide-react";
import LimitEditor from "./LimitEditor";

const gold = "var(--brand, #c9a83a)";

const linkedinStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  active:     { label: "Active",     color: "#16A34A", bg: "#DCFCE7" },
  restricted: { label: "Restricted", color: "#D97706", bg: "#FFFBEB" },
  banned:     { label: "Banned",     color: "#DC2626", bg: "#FEE2E2" },
  warning:    { label: "Warning",    color: "#7C3AED", bg: "#EDE9FE" },
};

async function getSellerDetail(sellerId: string) {
  const supabase = await getSupabaseServer();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [{ data: seller }, { data: todayMsgs }, { data: weekMsgs }, { data: monthMsgs }, { data: activeCamps }, { data: replies }] = await Promise.all([
    supabase.from("sellers").select("*").eq("id", sellerId).single(),
    supabase.from("campaign_messages").select("id, status, sent_at, channel").eq("seller_id", sellerId).gte("sent_at", today.toISOString()),
    supabase.from("campaign_messages").select("id, status").eq("seller_id", sellerId).gte("sent_at", weekAgo).eq("channel", "linkedin"),
    supabase.from("campaign_messages").select("id, status, sent_at, step_number, channel, content, campaign_id").eq("seller_id", sellerId).gte("sent_at", monthAgo).eq("channel", "linkedin").order("sent_at", { ascending: false }).limit(20),
    supabase.from("campaigns").select("id, name, current_step, sequence_steps, status, leads(primary_first_name, primary_last_name, company_name)").eq("seller_id", sellerId).eq("status", "active").limit(10),
    supabase.from("lead_replies").select("id, classification, received_at, reply_text, lead_id, leads(primary_first_name, primary_last_name)").eq("channel", "linkedin").gte("received_at", weekAgo).order("received_at", { ascending: false }).limit(20),
  ]);

  return { seller, todayMsgs: todayMsgs ?? [], weekMsgs: weekMsgs ?? [], monthMsgs: monthMsgs ?? [], activeCamps: activeCamps ?? [], replies: replies ?? [] };
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function LinkedInAccountDetail({ params }: { params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  const { seller, todayMsgs, weekMsgs, monthMsgs, activeCamps, replies } = await getSellerDetail(sellerId);
  if (!seller) notFound();

  const linkedinTodayCount = todayMsgs.filter(m => m.channel === "linkedin").length;
  const dailyLimit = seller.linkedin_daily_limit ?? 50;
  const usagePct = Math.min(100, Math.round((linkedinTodayCount / dailyLimit) * 100));

  const weekSent = weekMsgs.length;
  const weekFailed = weekMsgs.filter(m => m.status === "failed").length;
  const failRate = weekSent > 0 ? Math.round((weekFailed / weekSent) * 100) : 0;

  const replyRate = weekSent > 0 ? Math.round((replies.length / weekSent) * 100) : 0;

  const status = seller.linkedin_status ?? "active";
  const statusMeta = linkedinStatusMeta[status] ?? linkedinStatusMeta.active;
  const hasIssue = status !== "active";

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/accounts" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Accounts
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{seller.name}</span>
      </div>

      {/* Header */}
      <div className="rounded-2xl border mb-6 overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)" }}>
        <div className="p-6 flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
              {seller.name[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.linkedin }}>LinkedIn Account</p>
              <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{seller.name}</h1>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: statusMeta.bg, color: statusMeta.color }}>
                  {statusMeta.label.toUpperCase()}
                </span>
                {seller.unipile_account_id && (
                  <span className="text-xs" style={{ color: C.textMuted }}>
                    Unipile ID: <code className="text-[10px]">{seller.unipile_account_id.substring(0, 16)}...</code>
                  </span>
                )}
              </div>
            </div>
          </div>

          {hasIssue && (
            <div className="rounded-lg border px-4 py-3 max-w-md"
              style={{ backgroundColor: statusMeta.bg, borderColor: `${statusMeta.color}40` }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} style={{ color: statusMeta.color }} className="shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold" style={{ color: statusMeta.color }}>Issue detected</p>
                  <p className="text-xs mt-0.5" style={{ color: C.textBody }}>
                    {seller.linkedin_status_note ?? "Account has been flagged. Check LinkedIn manually."}
                  </p>
                  {seller.linkedin_status_updated_at && (
                    <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>
                      Updated {timeAgo(seller.linkedin_status_updated_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Usage bar */}
        <div className="border-t px-6 py-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold" style={{ color: C.textMuted }}>
              Today&apos;s usage
            </p>
            <p className="text-xs font-bold tabular-nums" style={{ color: C.textPrimary }}>
              {linkedinTodayCount} / {dailyLimit}
            </p>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
            <div className="h-full transition-[opacity,transform,box-shadow,background-color,border-color]" style={{
              width: `${usagePct}%`,
              background: usagePct > 80 ? `linear-gradient(90deg, ${C.phone}, ${C.red})` : `linear-gradient(90deg, ${C.linkedin}, #4A90E2)`,
            }} />
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Sent this week",   value: weekSent,       sub: "LinkedIn messages", color: C.linkedin, icon: Send },
          { label: "Reply rate",       value: `${replyRate}%`, sub: `${replies.length} replies`, color: C.green,    icon: MessageSquare },
          { label: "Fail rate",        value: `${failRate}%`,  sub: `${weekFailed} failed`,      color: failRate > 10 ? C.red : C.textMuted, icon: AlertTriangle },
          { label: "Active campaigns", value: activeCamps.length, sub: "in progress",             color: gold,       icon: Users },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="rounded-2xl border p-4" style={{ background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${color} 5%, var(--c-card)) 100%)`, borderColor: C.border, borderTop: `3px solid ${color}`, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</p>
              <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}15` }}>
                <Icon size={13} style={{ color }} />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Outreach Limits — editable */}
      <div className="mb-6">
        <LimitEditor sellerId={seller.id} initialLimit={dailyLimit} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent activity */}
        <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
            <TrendingUp size={14} style={{ color: C.textMuted }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Recent LinkedIn Activity</h3>
          </div>
          {monthMsgs.length === 0 ? (
            <div className="py-12 text-center">
              <Clock size={22} className="mx-auto mb-2" style={{ color: C.textDim }} />
              <p className="text-xs" style={{ color: C.textMuted }}>No recent activity</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {monthMsgs.map((m, i) => (
                <div key={m.id} className="px-5 py-3 flex items-start gap-3"
                  style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `${C.linkedin}15` }}>
                    <Share2 size={12} style={{ color: C.linkedin }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>Step {m.step_number}</p>
                      {m.status === "sent" ? (
                        <CheckCircle size={10} style={{ color: C.green }} />
                      ) : m.status === "failed" ? (
                        <AlertTriangle size={10} style={{ color: C.red }} />
                      ) : (
                        <PauseCircle size={10} style={{ color: C.textMuted }} />
                      )}
                      <span className="text-[10px]" style={{ color: C.textMuted }}>· {m.status}</span>
                    </div>
                    {m.content && <p className="text-[11px] line-clamp-2 mt-0.5" style={{ color: C.textBody }}>{m.content}</p>}
                    <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{timeAgo(m.sent_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active campaigns */}
        <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
            <Users size={14} style={{ color: C.textMuted }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Active Campaigns ({activeCamps.length})</h3>
          </div>
          {activeCamps.length === 0 ? (
            <div className="py-12 text-center">
              <Users size={22} className="mx-auto mb-2" style={{ color: C.textDim }} />
              <p className="text-xs" style={{ color: C.textMuted }}>No active campaigns</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {activeCamps.map((c: any, i: number) => {
                const leadName = `${c.leads?.primary_first_name ?? ""} ${c.leads?.primary_last_name ?? ""}`.trim() || "Unknown";
                const totalSteps = Array.isArray(c.sequence_steps) ? c.sequence_steps.length : 0;
                return (
                  <Link key={c.id} href={`/campaigns/${c.id}`}
                    className="px-5 py-3 flex items-center gap-3 hover:bg-black/[0.015] transition-colors"
                    style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none", display: "flex" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{leadName}</p>
                      <p className="text-[10px]" style={{ color: C.textMuted }}>{c.leads?.company_name ?? "—"}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{c.name} · Step {c.current_step + 1}/{totalSteps}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
