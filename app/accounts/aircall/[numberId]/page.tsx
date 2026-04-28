import { getSupabaseServer } from "@/lib/supabase-server";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Phone, PhoneCall, PhoneMissed, Voicemail, Clock, CheckCircle, XCircle } from "lucide-react";

const FLAGS: Record<string, string> = { DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽", ES: "🇪🇸", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧" };

async function getNumber(id: string) {
  const AUTH = Buffer.from(`${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.aircall.io/v1/numbers/${id}`, {
    headers: { Authorization: `Basic ${AUTH}` },
    next: { revalidate: 120 },
  });
  if (!res.ok) return null;
  const { number } = await res.json();
  return number;
}

async function getCallStats(numberDigits: string) {
  const supabase = await getSupabaseServer();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Note: calls.phone_number stores the called number, not the calling number
  // For aircall_number tracking we'd need a different approach. For now fetch all recent calls.
  const [{ data: weekCalls }, { data: monthCalls }] = await Promise.all([
    supabase.from("calls").select("id, status, duration, classification").gte("started_at", weekAgo),
    supabase.from("calls").select("id, status, duration, classification, phone_number, started_at, ended_at, direction, lead_id, ai_summary, leads(primary_first_name, primary_last_name, company_name)").gte("started_at", monthAgo).order("started_at", { ascending: false }).limit(30),
  ]);

  return { weekCalls: weekCalls ?? [], monthCalls: monthCalls ?? [] };
}

function secsToMMSS(s: number | null) {
  if (!s) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
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

export default async function AircallNumberDetail({ params }: { params: Promise<{ numberId: string }> }) {
  const { numberId } = await params;
  const number = await getNumber(numberId);
  if (!number) notFound();
  const { weekCalls, monthCalls } = await getCallStats(number.digits);

  const answered = weekCalls.filter(c => c.status === "answered").length;
  const missed = weekCalls.filter(c => c.status === "missed").length;
  const voicemail = weekCalls.filter(c => c.status === "voicemail").length;
  const total = weekCalls.length;
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;

  const totalMins = Math.round(weekCalls.reduce((s, c) => s + (c.duration ?? 0), 0) / 60);
  const avgDuration = answered > 0 ? Math.round(weekCalls.filter(c => c.status === "answered").reduce((s, c) => s + (c.duration ?? 0), 0) / answered) : 0;

  const positiveCount = weekCalls.filter(c => c.classification === "positive" || c.classification === "meeting_intent").length;
  const negativeCount = weekCalls.filter(c => c.classification === "negative" || c.classification === "wrong_number").length;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/accounts" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Accounts
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{number.name}</span>
      </div>

      {/* Header */}
      <div className="rounded-2xl border p-6 mb-6 flex items-center gap-5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl shrink-0" style={{ backgroundColor: `${C.phone}15` }}>
          {FLAGS[number.country] ?? "📞"}
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.phone }}>Aircall Number</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{number.name || number.country}</h1>
          <p className="text-sm mt-1 tabular-nums" style={{ color: C.textMuted }}>{number.digits}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>
            {(number.availability_status ?? "available").toUpperCase()}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Calls this week", value: total, sub: `${answered} answered`, color: C.phone, icon: Phone },
          { label: "Answer rate",     value: `${answerRate}%`, sub: `${missed} missed`, color: C.green, icon: CheckCircle },
          { label: "Talk time",       value: `${totalMins}m`, sub: `avg ${secsToMMSS(avgDuration)}`, color: gold, icon: Clock },
          { label: "Positive",        value: positiveCount, sub: `${negativeCount} negative`, color: "#7C3AED", icon: PhoneCall },
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

      {/* Recent calls */}
      <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
          <PhoneCall size={14} style={{ color: C.textMuted }} />
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Recent Calls (last 30)</h3>
        </div>
        {monthCalls.length === 0 ? (
          <div className="py-16 text-center">
            <Phone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm" style={{ color: C.textMuted }}>No calls yet</p>
            <p className="text-xs mt-1" style={{ color: C.textDim }}>Make a call to see it here.</p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            {monthCalls.map((call: any, i: number) => {
              const leadName = call.leads ? `${call.leads.primary_first_name ?? ""} ${call.leads.primary_last_name ?? ""}`.trim() : null;
              const StatusIcon = call.status === "answered" ? CheckCircle : call.status === "missed" ? PhoneMissed : call.status === "voicemail" ? Voicemail : XCircle;
              const statusColor = call.status === "answered" ? C.green : call.status === "missed" ? C.red : "#D97706";
              return (
                <div key={call.id} className="px-5 py-3 flex items-center gap-4"
                  style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${statusColor}15` }}>
                    <StatusIcon size={13} style={{ color: statusColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {call.lead_id && leadName ? (
                        <Link href={`/leads/${call.lead_id}`} className="text-sm font-semibold hover:underline" style={{ color: C.textPrimary }}>
                          {leadName}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{call.phone_number ?? "Unknown"}</span>
                      )}
                      {call.leads?.company_name && (
                        <span className="text-xs" style={{ color: C.textMuted }}>· {call.leads.company_name}</span>
                      )}
                      {call.classification && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{
                          backgroundColor: call.classification === "positive" || call.classification === "meeting_intent" ? "#DCFCE7" : call.classification === "negative" || call.classification === "wrong_number" ? "#FEE2E2" : "#F3F4F6",
                          color: call.classification === "positive" || call.classification === "meeting_intent" ? "#16A34A" : call.classification === "negative" || call.classification === "wrong_number" ? "#DC2626" : C.textMuted,
                        }}>
                          {call.classification.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {call.ai_summary && (
                      <p className="text-xs line-clamp-1" style={{ color: C.textBody }}>{call.ai_summary}</p>
                    )}
                    <p className="text-[10px]" style={{ color: C.textDim }}>
                      {call.direction} · {secsToMMSS(call.duration)} · {timeAgo(call.started_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const gold = "var(--brand, #c9a83a)";
