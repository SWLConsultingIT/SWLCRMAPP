"use client";

// Read-only conversation thread for a single lead — the same back-and-forth
// chat view the /queue Inbox shows in its right pane, but scoped to one lead
// and without any review/classify actions. Reuses the existing thread API
// (/api/inbox/thread/[leadId]) so the conversation is consistent everywhere.
// Mounted inside the lead detail's "Recent Activity" tab via a Timeline/Chat
// toggle (Fran 2026-06-02).

import { useCallback, useEffect, useState } from "react";
import { Share2, Mail, Phone, Smartphone, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";
import InboxComposer from "./InboxComposer";

type ThreadEntry = {
  id: string;
  direction: "outbound" | "inbound" | "event";
  channel: string | null;
  body: string;
  subject?: string | null;
  at: string;
  stepNumber?: number | null;
  kind?: string;
  source?: "db" | "unipile";
};

function channelIcon(ch: string | null) {
  if (ch === "linkedin") return Share2;
  if (ch === "email") return Mail;
  if (ch === "call" || ch === "phone") return Phone;
  if (ch === "whatsapp" || ch === "sms") return Smartphone;
  return MessageSquare;
}
function channelColor(ch: string | null): string {
  if (ch === "linkedin") return C.linkedin;
  if (ch === "email") return C.email;
  if (ch === "call" || ch === "phone") return C.phone;
  if (ch === "whatsapp") return "#25D366";
  return C.textMuted;
}
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date(), yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Hoy";
  if (same(d, yest)) return "Ayer";
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" });
}

export default function LeadChatThread({ leadId, leadName }: { leadId?: string; leadName?: string | null }) {
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!leadId) { setThread([]); setLoading(false); return () => {}; }
    let cancelled = false;
    fetch(`/api/inbox/thread/${leadId}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { thread: [] }))
      .then(data => { if (!cancelled) setThread(Array.isArray(data.thread) ? data.thread : []); })
      .catch(() => { if (!cancelled) setThread([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  // Latest inbound channel → tells the composer how to send.
  const lastInboundChannel = [...thread].reverse().find(e => e.direction === "inbound")?.channel ?? null;
  const lastEmailSubject = (() => {
    const s = [...thread].reverse().find(e => e.channel === "email" && e.subject)?.subject;
    return s ? `Re: ${s.replace(/^re:\s*/i, "")}` : null;
  })();

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse px-2">
        {[0, 1, 2].map(i => (
          <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
            <div className="rounded-2xl h-14" style={{ width: `${55 + i * 6}%`, backgroundColor: C.border, opacity: 0.4 }} />
          </div>
        ))}
      </div>
    );
  }

  if (thread.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border py-14 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-semibold" style={{ color: C.textBody }}>Sin mensajes todavía</p>
          <p className="text-xs mt-1" style={{ color: C.textMuted }}>
            Cuando el lead responda o le mandes algo, va a aparecer acá.
          </p>
        </div>
        {leadId && <InboxComposer leadId={leadId} channel={lastInboundChannel} onSent={reload} defaultSubject={lastEmailSubject} />}
      </div>
    );
  }

  const leadAv = initials(leadName);
  let lastDay: string | null = null;

  return (
    <div className="space-y-3">
    <div className="rounded-2xl border px-4 py-4 space-y-3" style={{ backgroundColor: `color-mix(in srgb, ${C.surface} 40%, ${C.bg})`, borderColor: C.border }}>
      {thread.map(entry => {
        const isOut = entry.direction === "outbound";
        const Icon = channelIcon(entry.channel);
        const dKey = new Date(entry.at).toDateString();
        const showDay = dKey !== lastDay;
        lastDay = dKey;
        const stepLabel = entry.stepNumber === 0 ? "Connection Request"
          : entry.stepNumber != null && entry.stepNumber > 0 ? `Step ${entry.stepNumber}`
          : (entry.kind === "auto_reply" || (entry.source === "unipile" && isOut)) ? "Auto-reply" : null;
        return (
          <div key={entry.id}>
            {showDay && (
              <div className="flex items-center gap-3 my-4 first:mt-0">
                <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
                  style={{ color: C.textDim, backgroundColor: C.surface }}>{dayLabel(entry.at)}</span>
                <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
              </div>
            )}
            <div className={`flex items-end gap-2 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                style={isOut
                  ? { backgroundColor: `color-mix(in srgb, ${channelColor(entry.channel)} 18%, transparent)`, color: channelColor(entry.channel) }
                  : { backgroundColor: "#E5E7EB", color: "#374151" }}>
                {isOut ? <Icon size={12} /> : leadAv}
              </div>
              <div className={`flex flex-col max-w-[78%] ${isOut ? "items-end" : "items-start"}`}>
                <div className="rounded-2xl px-4 py-2.5 shadow-sm"
                  style={{
                    borderTopLeftRadius: isOut ? 18 : 4,
                    borderTopRightRadius: isOut ? 4 : 18,
                    backgroundColor: isOut ? `color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)` : C.card,
                    border: `1px solid ${isOut ? `color-mix(in srgb, var(--brand, #c9a83a) 28%, transparent)` : C.border}`,
                    color: C.textPrimary,
                  }}>
                  {entry.subject && (
                    <p className="text-[11px] font-semibold mb-1" style={{ color: C.textMuted }}>{entry.subject}</p>
                  )}
                  {entry.body && entry.body.trim()
                    ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{entry.body}</p>
                    : <p className="text-sm" style={{ color: C.textMuted }}>(sin contenido)</p>}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px]" style={{ color: C.textDim }}>
                  <span className="tabular-nums">{timeOnly(entry.at)}</span>
                  {stepLabel && (
                    <>
                      <span>·</span>
                      <span className="px-1 py-0.5 rounded font-medium" style={{ backgroundColor: C.surface, color: C.textMuted }}>{stepLabel}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    {leadId && <InboxComposer leadId={leadId} channel={lastInboundChannel} onSent={reload} defaultSubject={lastEmailSubject} />}
    </div>
  );
}
