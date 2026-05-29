"use client";

// Messages-by-step section for the campaign detail page.
// Per step: a collapsible card showing the latest sent message (the rendered
// body + the raw template that drove it) plus a list of replies attributed
// to that step. Built for "see exactly what we sent, what they said back,
// and whether it converted" — the missing piece between aggregate step
// performance numbers and the per-lead engagement timeline.

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Mail, Share2, Phone, Smartphone, Send, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";
import { dicts, type Locale } from "@/lib/i18n-dicts";

export type MessageStepGroup = {
  step: number;
  channel: string;
  sent: number;
  replied: number;
  replyRate: number | null;
  example: { rendered: string; template: string; sentAt: string | null };
  replies: Array<{
    replyId: string;
    leadId: string | null;
    leadName: string;
    classification: string;
    receivedAt: string | null;
    text: string;
  }>;
};

const channelMeta: Record<string, { Icon: React.ElementType; color: string; label: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2", label: "LinkedIn" },
  email:    { Icon: Mail,       color: "#059669", label: "Email" },
  call:     { Icon: Phone,      color: "#EA580C", label: "Call" },
  whatsapp: { Icon: Smartphone, color: "#25D366", label: "WhatsApp" },
};

const classColor: Record<string, string> = {
  positive: "#16A34A", meeting_intent: "#059669", negative: "#DC2626", not_now: "#F59E0B",
  unsubscribe: "#9CA3AF", needs_info: "#7C3AED", question: "#0A66C2", nurturing: "#6B7280",
  spam: "#374151", auto_reply: "#94A3B8", unclassified: "#9CA3AF",
};

function tx(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let s = dicts[locale][key] ?? dicts.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

export default function MessagesByStep({ groups, locale }: { groups: MessageStepGroup[]; locale: Locale }) {
  const dateLoc = locale === "es" ? "es-AR" : "en-US";
  const tr = (k: string, fallback: string, vars?: Record<string, string | number>) => {
    const v = tx(locale, k, vars);
    return v === k ? fallback : v;
  };
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(dateLoc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <div className="space-y-3">
      {groups.map(g => (
        <StepCard key={g.step} g={g} fmt={fmt} tr={tr} />
      ))}
    </div>
  );
}

function StepCard({
  g,
  fmt,
  tr,
}: {
  g: MessageStepGroup;
  fmt: (iso: string | null) => string;
  tr: (k: string, fallback: string, vars?: Record<string, string | number>) => string;
}) {
  // CR (step 0) defaults open, others closed — sellers usually want to drill
  // into the CR copy first since it's the gate to everything else.
  const [open, setOpen] = useState(g.step === 0);
  const [showTemplate, setShowTemplate] = useState(false);
  const ch = channelMeta[g.channel] ?? channelMeta.email;
  const ChIcon = ch.Icon;
  const isCR = g.step === 0;
  const stepLabel = isCR
    ? tr("dashx.detail.campaign.msgs.crLabel", "Step 1 · Connection request")
    : tr("dashx.detail.campaign.msgs.stepLabel", "Step {n}", { n: g.step + 1 });

  return (
    <div id={`step-msg-${g.step}`} className="rounded-xl border overflow-hidden scroll-mt-20"
      style={{ borderColor: C.border, backgroundColor: C.card }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-black/[0.02] transition-colors"
      >
        <ChevronRight size={14} style={{
          color: C.textMuted,
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform .15s ease",
        }} />
        <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${ch.color} 14%, transparent)`, color: ch.color }}>
          <ChIcon size={12} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{stepLabel}</p>
          <p className="text-[10.5px]" style={{ color: C.textMuted }}>
            {ch.label} · {tr("dashx.detail.campaign.msgs.lastSent", "Last sent")}: {fmt(g.example.sentAt)}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
          <span><span className="font-bold" style={{ color: C.textBody }}>{g.sent}</span> <span style={{ color: C.textDim }}>{tr("dashx.step.colSent", "sent")}</span></span>
          {!isCR && (
            <>
              <span><span className="font-bold" style={{ color: g.replied > 0 ? "#059669" : C.textBody }}>{g.replied}</span> <span style={{ color: C.textDim }}>{tr("dashx.step.colReplied", "replied")}</span></span>
              <span><span className="font-bold" style={{ color: g.replyRate && g.replyRate > 0 ? "#059669" : C.textBody }}>{g.replyRate === null ? "—" : `${g.replyRate}%`}</span></span>
            </>
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {/* Template example */}
          <div className="mt-3 rounded-lg border p-3"
            style={{ borderColor: C.border, backgroundColor: C.card }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
                {showTemplate
                  ? tr("dashx.detail.campaign.msgs.template", "Template (raw, before substitution)")
                  : tr("dashx.detail.campaign.msgs.example", "Latest sent message")}
              </p>
              <button
                type="button"
                onClick={() => setShowTemplate(v => !v)}
                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors"
                style={{ color: ch.color, backgroundColor: `color-mix(in srgb, ${ch.color} 10%, transparent)` }}
              >
                {showTemplate ? tr("dashx.detail.campaign.msgs.showExample", "Show example") : tr("dashx.detail.campaign.msgs.showTemplate", "Show template")}
              </button>
            </div>
            <p className="text-[12.5px] whitespace-pre-wrap" style={{ color: C.textBody, lineHeight: 1.5 }}>
              {(showTemplate ? g.example.template : g.example.rendered) || tr("dashx.detail.campaign.msgs.noBody", "(empty body)")}
            </p>
          </div>

          {/* Replies */}
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>
              {g.replies.length === 0
                ? tr("dashx.detail.campaign.msgs.repliesEmpty", "No replies attributed to this step yet")
                : tr("dashx.detail.campaign.msgs.repliesCount", "{n} recent replies", { n: g.replies.length })}
            </p>
            {g.replies.length > 0 && (
              <ul className="space-y-2">
                {g.replies.map(r => {
                  const c = classColor[r.classification] ?? "#9CA3AF";
                  return (
                    <li key={r.replyId} className="rounded-lg border p-2.5"
                      style={{ borderColor: `color-mix(in srgb, ${c} 24%, ${C.border})`, backgroundColor: C.card }}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        {r.leadId
                          ? <Link href={`/leads/${r.leadId}`} className="text-[12px] font-semibold hover:underline" style={{ color: C.textPrimary }}>{r.leadName}</Link>
                          : <span className="text-[12px] font-semibold" style={{ color: C.textPrimary }}>{r.leadName}</span>}
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0 rounded"
                          style={{ backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
                          <MessageSquare size={9} className="inline mr-0.5" />
                          {tr(`dashx.reply.${r.classification}`, r.classification.replace(/_/g, " "))}
                        </span>
                        <span className="text-[10.5px] tabular-nums" style={{ color: C.textDim }}>{fmt(r.receivedAt)}</span>
                      </div>
                      {r.text && (
                        <p className="text-[12px] mt-1.5 whitespace-pre-wrap" style={{ color: C.textBody, lineHeight: 1.45 }}>{r.text}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
