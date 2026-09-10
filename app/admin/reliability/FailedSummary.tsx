"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { AlertCircle, RotateCcw, Loader2, ChevronDown, ChevronRight, Info } from "lucide-react";
import { C } from "@/lib/design";

// Groups Failed Messages by error_details so a single dispatcher bug or
// rate-limit wave doesn't make the page look like 95 unrelated problems.
// Each group surfaces:
//   - The error text (raw)
//   - A human explanation of what causes it (when known)
//   - The recommended next step
//   - A "Retry all N" button that bulk-flips the bucket back to queued
//
// The full table still renders below this widget for cases where the
// operator needs row-level detail (which lead / when).

type FailedRow = {
  id: string;
  error_details: string | null;
  step_number: number;
  channel: string;
  created_at: string;
  leads?: { primary_first_name?: string | null; primary_last_name?: string | null; company_name?: string | null } | null;
  campaigns?: { sellers?: { name?: string | null } | null } | null;
};

// Known errors → human-readable explanation + suggested action.
// Add new entries here as we encounter recurring failure modes — the
// table below this dictionary is the primary UX surface for sellers
// who don't speak dispatcher-internal jargon.
//
// Module scope, so every field is a key. `matcher` stays code: it reads the
// dispatcher's raw English error string, which is not copy and never changes
// with the locale.
const ERROR_PLAYBOOK: { matcher: (msg: string) => boolean; titleKey: string; causeKey: string; actionKey: string }[] = [
  {
    matcher: m => m.includes("no LinkedIn slug"),
    titleKey: "rel.fail.noLi",
    causeKey: "rel.pb.noLi.cause",
    actionKey: "rel.pb.noLi.action",
  },
  {
    // Match the specific 422 string Unipile returns when the *recipient*
    // profile is private, restricted, or deleted. This must come BEFORE the
    // generic rate-limit matcher since both strings contain "422" — and a
    // locked profile has nothing to do with the seller's rate-limit state.
    matcher: m => m.includes("profile is not locked") || m.includes("recipient id is valid"),
    titleKey: "rel.fail.locked",
    causeKey: "rel.pb.locked.cause",
    actionKey: "rel.pb.locked.action",
  },
  {
    // Unipile's actual rate-limit string. We deliberately do NOT match plain
    // "422" here — Unipile uses 422 for several distinct errors and a blanket
    // match misclassified locked-profile failures as rate-limits.
    matcher: m => m.includes("temporary provider limit") || m.includes("too many requests") || m.includes("429"),
    titleKey: "rel.pb.rateLimit.title",
    causeKey: "rel.pb.rateLimit.cause",
    actionKey: "rel.pb.rateLimit.action",
  },
  {
    matcher: m => m.includes("already sent recently") || m.includes("already invited"),
    titleKey: "rel.fail.dupInvite",
    causeKey: "rel.pb.dupInvite.cause",
    actionKey: "rel.pb.dupInvite.action",
  },
  {
    matcher: m => m.includes("restricted") || m.includes("linkedin is restricted"),
    titleKey: "rel.pb.restricted.title",
    causeKey: "rel.pb.restricted.cause",
    actionKey: "rel.pb.restricted.action",
  },
  {
    matcher: m => m.includes("unipile_account_id"),
    titleKey: "rel.fail.noUnipile",
    causeKey: "rel.pb.noUnipile.cause",
    actionKey: "rel.pb.noUnipile.action",
  },
  {
    matcher: m => m.includes("lead or campaign missing"),
    titleKey: "rel.fail.deleted",
    causeKey: "rel.pb.deleted.cause",
    actionKey: "rel.pb.deleted.action",
  },
];

function explainError(rawError: string | null) {
  if (!rawError) return null;
  const hit = ERROR_PLAYBOOK.find(e => e.matcher(rawError.toLowerCase()));
  return hit ?? null;
}

export default function FailedSummary({ rows }: { rows: FailedRow[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Group by exact error string. Most dispatcher failures repeat the same
  // text 1:1, so exact-grouping works without needing fuzzy matching.
  const groups = useMemo(() => {
    const map = new Map<string, FailedRow[]>();
    for (const r of rows) {
      const key = r.error_details ?? "(no error captured)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([error, rs]) => ({ error, rows: rs, count: rs.length }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  async function retryGroup(messageIds: string[], errorKey: string) {
    setBusy(errorKey);
    try {
      // Cap-aware batching — the bulk endpoint limits to 500 per call,
      // which covers ~all real cases but loop anyway so we don't silently
      // drop rows if a future incident produces a bigger bucket.
      for (let i = 0; i < messageIds.length; i += 500) {
        const slice = messageIds.slice(i, i + 500);
        const res = await fetch("/api/admin/reliability/retry-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: slice }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      }
      router.refresh();
    } catch (err) {
      console.error("[reliability] bulk retry failed", err);
      alert(err instanceof Error ? err.message : t("rel.fail.bulkRetry"));
    } finally {
      setBusy(null);
    }
  }

  if (groups.length === 0) return null;

  return (
    <div className="px-5 py-4 space-y-3" style={{ backgroundColor: C.bg, borderBottom: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
        <Info size={12} /> {t("rel.groupedBy")}
      </div>
      {groups.map(g => {
        const playbook = explainError(g.error);
        const isExpanded = expandedGroup === g.error;
        const messageIds = g.rows.map(r => r.id);
        return (
          <div key={g.error}
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <button
              onClick={() => setExpandedGroup(isExpanded ? null : g.error)}
              className="w-full px-4 py-3 flex items-start gap-3 text-left hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "transparent" }}>
              {isExpanded
                ? <ChevronDown size={14} className="mt-0.5 shrink-0" style={{ color: C.textMuted }} />
                : <ChevronRight size={14} className="mt-0.5 shrink-0" style={{ color: C.textMuted }} />}
              <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: C.red }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                    {playbook ? t(playbook.titleKey) : g.error}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold tabular-nums"
                    style={{ backgroundColor: `${C.red}15`, color: C.red }}>
                    {g.count} {g.count === 1 ? "message" : "messages"}
                  </span>
                </div>
                {playbook && (
                  <p className="text-[11px] mt-1 italic" style={{ color: C.textMuted }}>
                    Raw error: <code style={{ fontFamily: "monospace" }}>{g.error}</code>
                  </p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); retryGroup(messageIds, g.error); }}
                disabled={busy === g.error}
                className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.gold, color: "#04070d" }}>
                {busy === g.error ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                Retry all {g.count}
              </button>
            </button>
            {isExpanded && playbook && (
              <div className="px-4 pb-4 pt-1 border-t space-y-2" style={{ borderColor: C.border }}>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{t("rel.whatThisMeans")}</p>
                  <p className="text-xs" style={{ color: C.textBody }}>{t(playbook.causeKey)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{t("rel.recommended")}</p>
                  <p className="text-xs" style={{ color: C.textBody }}>{t(playbook.actionKey)}</p>
                </div>
              </div>
            )}
            {isExpanded && !playbook && (
              <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: C.border }}>
                <p className="text-xs italic" style={{ color: C.textMuted }}>
                  No playbook entry for this error yet. Treat as one-off — retry once, escalate if it persists.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
