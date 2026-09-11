"use client";

// Company → Contacts: an operative table (not big cards). Answers "who are we
// working inside this account?" at a glance. Row → canonical /leads/[id].
// Next Action derives from the Activities system; Last interaction from the
// latest message/reply/call/activity. Both are computed server-side in one
// batched pass (no N+1) and passed in.

import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { Mail, Phone } from "lucide-react";
import { EmptyLine } from "@/components/lead/ui";

export type ContactRow = {
  id: string; name: string; role: string | null; seniority: string | null;
  seller: string | null; lifecycle: string; lifecycleColor: string;
  nextAction: { label: string; tone: "overdue" | "today" | "upcoming" | "none" } | null;
  lastInteraction: string | null;
  channels: { linkedin: boolean; email: boolean; phone: boolean };
};

const gold = "var(--brand, #c9a83a)";

function naColor(tone?: string) {
  return tone === "overdue" ? C.red : tone === "today" ? gold : tone === "upcoming" ? C.textBody : C.textDim;
}

export default function CompanyContacts({ contacts }: { contacts: ContactRow[] }) {
  const { t } = useLocale();
  if (!contacts.length) return <EmptyLine>{t("co.noContacts")}</EmptyLine>;

  const cols = "minmax(180px,1.7fr) 0.9fr 0.9fr 1fr minmax(150px,1.3fr) 1.1fr 72px";

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 860 }}>
          {/* header */}
          <div className="grid gap-3 px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-[0.09em]"
            style={{ gridTemplateColumns: cols, color: C.textMuted, backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <div>{t("co.col.contact")}</div><div>{t("co.col.seniority")}</div><div>{t("pulse.col.seller")}</div>
            <div>{t("ld2.lifecycle")}</div><div>{t("co.col.nextAction")}</div><div>{t("co.col.lastInteraction")}</div><div>{t("lost.channels")}</div>
          </div>
          {contacts.map(c => (
            <Link key={c.id} href={`/leads/${c.id}`}
              className="grid gap-3 px-4 py-3 items-center transition-colors hover:bg-black/[0.02]"
              style={{ gridTemplateColumns: cols, borderBottom: `1px solid ${C.border}` }}>
              <div className="min-w-0">
                <p className="text-[13px] font-bold truncate" style={{ color: C.textPrimary }}>{c.name}</p>
                <p className="text-[11.5px] truncate" style={{ color: C.textMuted }}>{c.role ?? "—"}</p>
              </div>
              <div className="text-[12px]" style={{ color: C.textBody }}>{c.seniority ?? "—"}</div>
              <div className="text-[12px]" style={{ color: C.textBody }}>{c.seller ?? "—"}</div>
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2 py-0.5"
                  style={{ color: c.lifecycleColor, backgroundColor: `color-mix(in srgb, ${c.lifecycleColor} 14%, transparent)` }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.lifecycleColor }} /> {c.lifecycle}
                </span>
              </div>
              <div className="text-[12px] font-semibold truncate" style={{ color: naColor(c.nextAction?.tone) }}>
                {c.nextAction ? c.nextAction.label : <span style={{ color: C.textDim, fontWeight: 400 }}>—</span>}
              </div>
              <div className="text-[11.5px]" style={{ color: C.textMuted }}>{c.lastInteraction ?? <span style={{ color: C.textDim }}>—</span>}</div>
              <div className="flex items-center gap-1.5" style={{ color: C.textDim }}>
                {c.channels.linkedin && <LinkedInIcon size={13} />}
                {c.channels.email && <Mail size={13} />}
                {c.channels.phone && <Phone size={13} />}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
