// History — last 50 reliability events for the active tenant.
// Derived from campaign_messages + lead_replies + seller cooldown
// timestamps; see lib/reliability-history.ts.

import { History, Send, MessageSquare, AlertOctagon, PauseCircle } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import { getTenantHistory, type HistoryEvent } from "@/lib/reliability-history";

const gold = "var(--brand, #c9a83a)";

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "seg";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function toneForEvent(type: HistoryEvent["type"]) {
  switch (type) {
    case "failure":  return { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 8%, transparent)", border: "color-mix(in srgb, #DC2626 28%, transparent)", icon: AlertOctagon };
    case "cooldown": return { fg: "#D97706", bg: "color-mix(in srgb, #D97706 8%, transparent)", border: "color-mix(in srgb, #D97706 28%, transparent)", icon: PauseCircle };
    case "reply":    return { fg: C.linkedin, bg: `color-mix(in srgb, ${C.linkedin} 8%, transparent)`, border: `color-mix(in srgb, ${C.linkedin} 28%, transparent)`, icon: MessageSquare };
    case "send":     return { fg: C.green, bg: `color-mix(in srgb, ${C.green} 8%, transparent)`, border: `color-mix(in srgb, ${C.green} 28%, transparent)`, icon: Send };
  }
}

export default async function HistorySection({ bioId }: { bioId: string }) {
  const t = await getT();
  const events = await getTenantHistory(bioId);

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: gold,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-7 py-6 border-b flex items-center gap-3" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 3%, ${C.card}) 100%)`,
      }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
            color: "#1A1A2E",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          <History size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {t("rel.history.title")}
          </h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.history.subtitle")}</p>
        </div>
      </header>

      {events.length === 0 ? (
        <div className="px-7 py-6 text-[12.5px]" style={{ color: C.textMuted }}>
          {t("rel.history.empty")}
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: C.border }}>
          {events.map((e, i) => {
            const tone = toneForEvent(e.type);
            const Icon = tone.icon;
            return (
              <div key={i} className="px-7 py-3 flex items-center gap-3" style={{ borderColor: C.border }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>
                  <Icon size={12} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] leading-tight" style={{ color: C.textPrimary }}>
                    <span className="font-semibold uppercase tracking-wider text-[10px] mr-2" style={{ color: tone.fg }}>{e.type}</span>
                    {e.leadName && <span style={{ color: C.textBody }}>{e.leadName}</span>}
                    {e.channel && <span style={{ color: C.textMuted }}> · {e.channel}</span>}
                    {e.campaignName && <span style={{ color: C.textMuted }}> · {e.campaignName}</span>}
                  </p>
                  {e.detail && (
                    <p className="text-[10.5px] mt-0.5 truncate" style={{ color: C.textMuted, fontFamily: "ui-monospace, monospace" }}>
                      {e.detail}
                    </p>
                  )}
                </div>
                <span className="text-[10.5px] tabular-nums shrink-0" style={{ color: C.textMuted }}>{formatWhen(e.occurredAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
