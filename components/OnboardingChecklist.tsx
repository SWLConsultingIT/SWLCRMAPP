"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, X, Share2, Target, Upload, Megaphone } from "lucide-react";
import { C } from "@/lib/design";

// First-run checklist that lives at the top of the dashboard until the tenant
// has connected LinkedIn, defined an ICP, imported leads, and created their
// first campaign. After all 4 are true the checklist disappears entirely.
// Dismiss-for-now is per-browser (localStorage) — re-opens after 7 days so
// users who forget about a step get a nudge eventually.

type Status = {
  hasSellerLinkedin: boolean;
  hasIcpApproved: boolean;
  hasLeads: boolean;
  hasCampaign: boolean;
};

const STORAGE_KEY = "growth-onboarding-dismissed-at";
const DISMISS_TTL_DAYS = 7;

export default function OnboardingChecklist({ status }: { status: Status }) {
  const [hidden, setHidden] = useState(true); // hidden until we read localStorage
  const [hydrated, setHydrated] = useState(false);

  const steps = [
    {
      id: "linkedin",
      label: "Connect LinkedIn",
      description: "Link a seller's LinkedIn via Unipile so outreach can dispatch.",
      icon: Share2,
      href: "/accounts",
      done: status.hasSellerLinkedin,
    },
    {
      id: "icp",
      label: "Define your first ICP",
      description: "Tell GrowthAI who your ideal customer is — industry, role, geography.",
      icon: Target,
      href: "/icp",
      done: status.hasIcpApproved,
    },
    {
      id: "leads",
      label: "Import leads",
      description: "Upload a CSV or XLSX. AI maps the columns automatically.",
      icon: Upload,
      href: "/leads/import",
      done: status.hasLeads,
    },
    {
      id: "campaign",
      label: "Launch your first campaign",
      description: "Pick channels + cadence and let AI draft the messages.",
      icon: Megaphone,
      href: "/campaigns?tab=new",
      done: status.hasCampaign,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;

  useEffect(() => {
    setHydrated(true);
    if (allDone) { setHidden(true); return; }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { setHidden(false); return; }
      const dismissedAt = parseInt(raw, 10);
      const expired = Date.now() - dismissedAt > DISMISS_TTL_DAYS * 86400_000;
      setHidden(!expired);
    } catch { setHidden(false); }
  }, [allDone]);

  function dismiss() {
    try { window.localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
    setHidden(true);
  }

  if (!hydrated || hidden || allDone) return null;

  return (
    <div
      className="rounded-2xl border mb-5 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, var(--brand, #c9a83a) 8%, var(--c-card)) 0%, var(--c-card) 60%)`,
        borderColor: `color-mix(in srgb, var(--brand, #c9a83a) 30%, var(--c-border))`,
        boxShadow: `0 8px 28px -10px color-mix(in srgb, var(--brand, #c9a83a) 28%, transparent)`,
      }}
    >
      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b" style={{ borderColor: `color-mix(in srgb, var(--brand, #c9a83a) 15%, var(--c-border))` }}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--brand, #c9a83a)" }}>
            Get started
          </p>
          <h2
            className="text-lg sm:text-xl font-bold leading-tight mt-1"
            style={{
              color: C.textPrimary,
              fontFamily: "var(--font-outfit), system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            Finish setup ({doneCount}/{steps.length})
          </h2>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: C.textMuted }}>
            Four quick steps to start sending. You can revisit anything from the sidebar.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss setup checklist (re-opens in 7 days)"
          title="Dismiss for now"
          className="rounded-md p-1 transition-opacity hover:opacity-70 shrink-0"
          style={{ color: C.textMuted }}
        >
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-3 sm:p-4">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.id}
              href={s.done ? "#" : s.href}
              onClick={(e) => { if (s.done) e.preventDefault(); }}
              className="group rounded-xl border p-3 flex items-start gap-2.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px"
              style={{
                backgroundColor: s.done ? `color-mix(in srgb, ${C.green} 7%, var(--c-card))` : "var(--c-card)",
                borderColor: s.done
                  ? `color-mix(in srgb, ${C.green} 30%, var(--c-border))`
                  : "var(--c-border)",
                cursor: s.done ? "default" : "pointer",
              }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: s.done
                    ? `color-mix(in srgb, ${C.green} 18%, transparent)`
                    : `color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)`,
                  color: s.done ? C.green : "var(--brand, #c9a83a)",
                }}
              >
                {s.done ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: C.textDim }}>
                    {i + 1}.
                  </span>
                  <p className="text-xs font-bold truncate" style={{ color: C.textPrimary }}>
                    {s.label}
                  </p>
                </div>
                <p className="text-[11px] leading-snug" style={{ color: C.textMuted }}>
                  {s.done ? "Done ✓" : s.description}
                </p>
              </div>
              {!s.done && (
                <ArrowRight
                  size={12}
                  className="shrink-0 mt-1 transition-transform group-hover:translate-x-0.5"
                  style={{ color: "var(--brand, #c9a83a)" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
