"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { Phone, Building2, Briefcase, ExternalLink, CheckCircle, Check, Loader } from "lucide-react";

type CallItem = {
  id: string;
  last_step_at: string | null;
  leads: { id: string; first_name: string; last_name: string; company: string; role: string; email: string; linkedin_url: string } | null;
  sellers: { name: string } | null;
};

type HistoryItem = {
  id: string;
  completed_at: string | null;
  leads: { id: string; first_name: string; last_name: string; company: string } | null;
  sellers: { name: string } | null;
};

function useTimeAgo() {
  const { t } = useLocale();
  return (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return t("calls.now");
    if (m < 60) return t("calls.minAgo").replace("{n}", String(m));
    const h = Math.floor(m / 60);
    if (h < 24) return t("calls.hoursAgo").replace("{n}", String(h));
    const d = Math.floor(h / 24);
    return t("calls.daysAgo").replace("{n}", String(d));
  };
}

export default function CallsClient({ initialQueue, history }: {
  initialQueue: CallItem[];
  history: HistoryItem[];
}) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const timeAgo = useTimeAgo();
  const [queue, setQueue] = useState(initialQueue);
  const [completing, setCompleting] = useState<string | null>(null);

  async function complete(campaignId: string) {
    setCompleting(campaignId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/complete`, { method: "POST" });
      if (res.ok) {
        setQueue(q => q.filter(c => c.id !== campaignId));
        router.refresh();
      }
    } finally {
      setCompleting(null);
    }
  }

  const pendingLabel = queue.length === 1
    ? t("calls.pending.one")
    : t("calls.pending").replace("{n}", String(queue.length));

  return (
    <div className="p-8">
      <PageHero
        icon={Phone}
        section={t("calls.section")}
        title={t("calls.title")}
        description={t("calls.desc")}
        accentColor={C.cyan}
        status={queue.length > 0 ? { label: pendingLabel, active: true } : undefined}
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Queue */}
        <div className="col-span-2 space-y-3">
          {queue.length === 0 ? (
            <div
              className="rounded-2xl border p-14 text-center"
              style={{
                backgroundColor: C.card,
                borderColor: C.border,
                boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
              }}
            >
              <div
                className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{
                  backgroundColor: `color-mix(in srgb, ${C.cyan} 8%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${C.cyan} 18%, transparent)`,
                }}
              >
                <Phone size={22} style={{ color: C.cyan }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                {t("calls.empty.title")}
              </p>
              <p className="text-xs mt-1.5" style={{ color: C.textDim }}>
                {t("calls.empty.sub")}
              </p>
            </div>
          ) : (
            queue.map((c, i) => (
              <div
                key={c.id}
                className="rounded-2xl border p-5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  backgroundColor: C.card,
                  borderColor: i === 0 ? `color-mix(in srgb, ${C.gold} 25%, transparent)` : C.border,
                  borderTop: `3px solid ${i === 0 ? C.gold : C.border}`,
                  boxShadow: i === 0
                    ? `0 0 0 1px color-mix(in srgb, ${C.gold} 8%, transparent), 0 4px 24px ${C.goldGlow}`
                    : "0 4px 16px rgba(0,0,0,0.04)",
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                    style={{
                      background: i === 0
                        ? `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`
                        : C.surface,
                      color: i === 0 ? "#04070d" : C.textMuted,
                      boxShadow: i === 0 ? `0 0 18px ${C.goldGlow}` : "none",
                    }}
                  >
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Link
                          href={`/leads/${c.leads?.id}`}
                          className="font-semibold text-base hover:underline"
                          style={{ color: C.textPrimary }}
                        >
                          {c.leads?.first_name} {c.leads?.last_name}
                        </Link>
                        <div className="flex items-center flex-wrap gap-3 mt-1.5">
                          {c.leads?.role && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: C.textBody }}>
                              <Briefcase size={11} style={{ color: C.textMuted }} />
                              {c.leads.role}
                            </span>
                          )}
                          {c.leads?.company && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: C.textBody }}>
                              <Building2 size={11} style={{ color: C.textMuted }} />
                              {c.leads.company}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-2">
                        <p className="text-sm font-bold" style={{ color: C.gold }}>{c.sellers?.name}</p>
                        {c.last_step_at && (
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {timeAgo(c.last_step_at)}
                          </p>
                        )}
                        <button
                          onClick={() => complete(c.id)}
                          disabled={completing === c.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-60 hover:-translate-y-0.5"
                          style={{
                            backgroundColor: C.greenGlow,
                            color: C.green,
                            border: `1px solid ${C.green}30`,
                          }}
                        >
                          {completing === c.id
                            ? <Loader size={11} className="animate-spin" />
                            : <Check size={11} />}
                          {t("calls.complete")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t flex items-center gap-4" style={{ borderColor: C.border }}>
                      {c.leads?.email && (
                        <a
                          href={`mailto:${c.leads.email}`}
                          className="text-xs transition-colors hover:underline"
                          style={{ color: C.textMuted }}
                        >
                          {c.leads.email}
                        </a>
                      )}
                      {c.leads?.linkedin_url && (
                        <a
                          href={c.leads.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium hover:underline"
                          style={{ color: C.cyan }}
                        >
                          <ExternalLink size={10} />
                          {t("calls.viewProfile")}
                        </a>
                      )}
                      {c.leads?.id && (
                        <Link
                          href={`/leads/${c.leads.id}`}
                          className="flex items-center gap-1 text-xs font-medium ml-auto hover:underline"
                          style={{ color: C.textMuted }}
                        >
                          {t("calls.viewHistory")} →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* History sidebar */}
        <div className="space-y-4">
          <div
            className="rounded-2xl border overflow-hidden"
            style={{
              backgroundColor: C.card,
              borderColor: C.border,
              borderTop: `3px solid ${C.green}`,
              boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
            }}
          >
            <div
              className="px-5 py-4 border-b flex items-center justify-between"
              style={{
                borderColor: C.border,
                background: "linear-gradient(90deg, rgba(61,220,132,0.06) 0%, transparent 60%)",
              }}
            >
              <div className="flex items-center gap-2">
                <CheckCircle size={13} style={{ color: C.green }} />
                <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                  {t("calls.completed")}
                </h2>
              </div>
              {history.length > 0 && (
                <span className="text-xs font-medium" style={{ color: C.textMuted }}>{history.length}</span>
              )}
            </div>
            <div className="p-5">
              {history.length === 0 ? (
                <p className="text-xs py-2" style={{ color: C.textDim }}>{t("calls.history.empty")}</p>
              ) : (
                <div className="space-y-3">
                  {history.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-start gap-2 pb-3 border-b last:border-0 last:pb-0"
                      style={{ borderColor: C.surface }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: C.green }} />
                      <div className="flex-1 min-w-0">
                        <Link
                          href={c.leads?.id ? `/leads/${c.leads.id}` : "#"}
                          className="text-sm font-medium hover:underline"
                          style={{ color: C.textPrimary }}
                        >
                          {c.leads?.first_name} {c.leads?.last_name}
                        </Link>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs truncate" style={{ color: C.textMuted }}>{c.leads?.company}</p>
                          <p className="text-xs tabular-nums shrink-0 ml-2" style={{ color: C.textDim }}>
                            {c.completed_at
                              ? new Date(c.completed_at).toLocaleDateString(
                                  locale === "es" ? "es-AR" : "en-GB",
                                  { day: "2-digit", month: "2-digit" }
                                )
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
