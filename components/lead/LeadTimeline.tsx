"use client";

// Presentational account-level interaction timeline. The server merges all
// sources (sent messages, replies, calls, campaign start, activities) into one
// chronological list and passes it here — this component only renders. Grouped
// by day, newest first. Colour stays neutral + gold; semantic colour only for
// real outcomes (positive=green, negative=red, callback/overdue=orange).

import { useState } from "react";
import { C } from "@/lib/design";
import { LinkedInIcon } from "@/components/SocialIcons";
import {
  Mail, Phone, Send, MessageSquare, UserPlus, Megaphone, CalendarClock, CheckCircle2,
  CornerDownLeft, ListTodo,
} from "lucide-react";
import { EmptyLine } from "@/components/lead/ui";

export type TimelineKind = "connection" | "message" | "reply" | "call" | "campaign" | "activity";
export type TimelineTone = "neutral" | "positive" | "negative" | "warning" | "info";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: string;                 // ISO
  channel?: string | null;    // linkedin | email | call | whatsapp | sms
  title: string;
  body?: string | null;
  tone?: TimelineTone;
  meta?: string | null;       // seller · duration · step · contact, etc.
  contactId?: string;         // account-level timeline: which contact this event belongs to
};

const gold = "var(--brand, #c9a83a)";

function toneColor(t?: TimelineTone) {
  return t === "positive" ? C.green : t === "negative" ? C.red : t === "warning" ? C.orange : t === "info" ? C.blue : C.textMuted;
}

function channelIcon(channel?: string | null, size = 13) {
  const c = (channel ?? "").toLowerCase();
  if (c === "linkedin") return <LinkedInIcon size={size} />;
  if (c === "email") return <Mail size={size} />;
  if (c === "call" || c === "phone") return <Phone size={size} />;
  if (c === "whatsapp" || c === "sms") return <MessageSquare size={size} />;
  return null;
}

function kindIcon(e: TimelineEvent, size = 13) {
  switch (e.kind) {
    case "connection": return <UserPlus size={size} />;
    case "message": return channelIcon(e.channel, size) ?? <Send size={size} />;
    case "reply": return <CornerDownLeft size={size} />;
    case "call": return <Phone size={size} />;
    case "campaign": return <Megaphone size={size} />;
    case "activity": return e.title.toLowerCase().includes("call") ? <Phone size={size} /> : <CalendarClock size={size} />;
    default: return <ListTodo size={size} />;
  }
}

function dayKey(iso: string, locale: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

function EventRow({ e, locale }: { e: TimelineEvent; locale: string }) {
  const [open, setOpen] = useState(false);
  const col = toneColor(e.tone);
  const time = new Date(e.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const long = (e.body?.length ?? 0) > 160;
  const bodyText = e.body ? (open || !long ? e.body : e.body.slice(0, 160) + "…") : null;
  return (
    <div className="relative pl-7 pb-3.5 last:pb-0">
      <span className="absolute left-0 top-0.5 w-5 h-5 rounded-full grid place-items-center"
        style={{ background: `color-mix(in srgb, ${col} 13%, transparent)`, color: col }}>
        {kindIcon(e)}
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{e.title}</span>
        {e.meta && <span className="text-[11px]" style={{ color: C.textMuted }}>· {e.meta}</span>}
        <span className="text-[11px] ml-auto tabular-nums" style={{ color: C.textDim }}>{time}</span>
      </div>
      {bodyText && (
        <p className="text-[12.5px] leading-relaxed mt-1" style={{ color: C.textBody }}>
          {e.kind === "reply" || e.kind === "message" ? <>&ldquo;{bodyText}&rdquo;</> : bodyText}
          {long && (
            <button onClick={() => setOpen(o => !o)} className="ml-1.5 text-[11px] font-semibold" style={{ color: gold }}>
              {open ? "less" : "more"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

export default function LeadTimeline({ events, locale = "en-US", emptyLabel }: {
  events: TimelineEvent[]; locale?: string; emptyLabel?: string;
}) {
  if (!events || events.length === 0) {
    return <EmptyLine><CheckCircle2 size={14} /> {emptyLabel ?? "No interactions yet"}</EmptyLine>;
  }
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Group by day preserving order.
  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of sorted) {
    const day = dayKey(e.at, locale);
    const g = groups.find(x => x.day === day);
    if (g) g.items.push(e); else groups.push({ day, items: [e] });
  }
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.day}>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2.5" style={{ color: C.textDim }}>{g.day}</p>
          <div className="relative ml-2 pl-0 border-l" style={{ borderColor: C.border }}>
            <div className="pl-4">
              {g.items.map(e => <EventRow key={e.id} e={e} locale={locale} />)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
