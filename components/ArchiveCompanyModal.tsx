"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X, Loader2, Archive } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

type Counts = {
  leads: number;
  campaigns: number;
  messages: number;
  replies: number;
  members: number;
};

export default function ArchiveCompanyModal({
  bioId,
  onClose,
  onArchived,
}: {
  bioId: string;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string>("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [typedName, setTypedName] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/company-bios/${bioId}/archive-preview`, { cache: "no-store" })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load preview");
        setCompanyName(d.company_name);
        setCounts(d.counts);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [bioId]);

  const matches = typedName.trim().toLowerCase() === companyName.toLowerCase();

  async function handleArchive() {
    if (!matches) return;
    setArchiving(true);
    setError(null);
    try {
      const res = await fetch(`/api/company-bios/${bioId}/archive`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to archive");
      onArchived();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
      setArchiving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="rounded-2xl border p-5 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: C.redLight }}>
              <AlertTriangle size={20} style={{ color: C.red }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>
              {t("archive.title").replace("{name}", companyName || "…")}
            </h2>
          </div>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: C.textMuted }} />
            <p className="text-xs" style={{ color: C.textMuted }}>Calculating impact…</p>
          </div>
        ) : counts ? (
          <>
            {/* System-impact warning — archiving the Company Bio is what the AI
                uses to write messages, score ICPs and suggest replies, and it
                anchors every active campaign for this tenant. Make that explicit. */}
            <div className="rounded-xl border p-3.5 mb-4 flex items-start gap-2.5" style={{ borderColor: `${C.red}55`, backgroundColor: `${C.red}12` }}>
              <AlertTriangle size={16} style={{ color: C.red, flexShrink: 0, marginTop: 1 }} />
              <p className="text-[11.5px] leading-relaxed" style={{ color: C.textBody }}>
                <strong style={{ color: C.red }}>This breaks the whole system for this tenant.</strong> Active campaigns stop sending, the AI loses the context it uses to write messages / score ICPs / suggest replies, and the team loses access. Don't archive unless you're certain.
              </p>
            </div>

            {/* Impact summary */}
            <div className="rounded-xl border p-4 mb-4" style={{ borderColor: `${C.red}30`, background: `linear-gradient(135deg, ${C.red}08 0%, ${C.red}14 100%)` }}>
              <p className="text-xs font-semibold mb-2" style={{ color: C.red }}>{t("archive.impact.title")}</p>
              <ul className="space-y-1.5">
                <ImpactRow label={t("archive.impact.leads")}      value={counts.leads} />
                <ImpactRow label={t("archive.impact.campaigns")}  value={counts.campaigns} />
                <ImpactRow label={t("archive.impact.messages")}   value={counts.messages} />
                <ImpactRow label={t("archive.impact.replies")}    value={counts.replies} />
                <ImpactRow label={t("archive.impact.members")} value={counts.members} />
              </ul>
            </div>

            {/* Recovery banner */}
            <div className="rounded-xl border p-3 mb-4 flex items-start gap-2.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <Archive size={14} style={{ color: C.textMuted, flexShrink: 0, marginTop: 2 }} />
              <p className="text-[11px] leading-relaxed" style={{ color: C.textBody }}>
                <strong>Recoverable for 30 days</strong> from <span className="font-mono">/admin/recovery</span>.
                After that, the data is <strong>permanently deleted</strong> by an automatic cleanup.
              </p>
            </div>

            {/* Type-to-confirm */}
            <div className="mb-5">
              <label className="text-[11px] font-semibold block mb-1.5" style={{ color: C.textMuted }}>
                Type <strong style={{ color: C.textPrimary }}>{companyName}</strong> to confirm
              </label>
              <input
                type="text"
                value={typedName}
                onChange={e => setTypedName(e.target.value)}
                placeholder={companyName}
                autoFocus
                className="w-full rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none"
                style={{
                  color: C.textPrimary,
                  backgroundColor: C.bg,
                  border: `2px solid ${matches ? C.red : C.border}`,
                }}
              />
            </div>
          </>
        ) : null}

        {error && (
          <div className="rounded-lg px-3 py-2 mb-4" style={{ backgroundColor: C.redLight }}>
            <p className="text-xs font-medium" style={{ color: C.red }}>{error}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={onClose} disabled={archiving}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: C.surface, color: C.textBody }}>
            {t("archive.cancel")}
          </button>
          <button onClick={handleArchive} disabled={!matches || archiving || loading || !!error}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: C.red, color: "#fff" }}>
            {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
            {archiving ? t("archive.confirming") : t("archive.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between text-xs">
      <span style={{ color: C.textBody }}>{label}</span>
      <span className="font-mono font-bold tabular-nums" style={{ color: value > 0 ? C.red : C.textDim }}>
        {value.toLocaleString()}
      </span>
    </li>
  );
}
