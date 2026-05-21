"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mail, ExternalLink, ChevronUp, Building2 } from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";
import { C } from "@/lib/design";
import CallButton from "@/components/CallButton";

type Props = {
  leadId: string;
  leadName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  aircallNumberId: number | null;
};

/**
 * Sticky action bar for the lead detail page. The Call / Email / LinkedIn
 * buttons in the page header scroll off as soon as the seller looks at the
 * tabs — which is exactly when they're most likely to want to act. This bar
 * fades in from the top of the viewport once the header passes the top of
 * the page, so dial / mail / view-LinkedIn are always one click away.
 *
 * IntersectionObserver on a tiny sentinel above the bar is cheap and runs
 * without any scroll handlers. The bar lives in the global stacking
 * context (fixed top: 0) so it floats above the tabs without affecting
 * layout.
 */
export default function StickyLeadActionBar({
  leadId, leadName, company, phone, email, linkedinUrl, aircallNumberId,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "0px 0px -90% 0px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  function backToTop() {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      {/* Sentinel — placed where the bar should START fading in. The bar
          becomes visible when this scrolls out of view (i.e. the seller
          has scrolled past the lead header). */}
      <div ref={sentinelRef} aria-hidden style={{ height: 1, width: 1, marginTop: -1 }} />

      <div
        className={`fixed top-0 left-0 right-0 z-40 transition-[opacity,transform] duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3 pointer-events-none"}`}
        style={{
          backgroundColor: "color-mix(in srgb, var(--card) 96%, transparent)",
          backdropFilter: "saturate(180%) blur(8px)",
          WebkitBackdropFilter: "saturate(180%) blur(8px)",
          borderBottom: `1px solid ${C.border}`,
          boxShadow: visible ? "0 8px 24px -12px rgba(0,0,0,0.18)" : "none",
        }}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
          {/* Up arrow — back to top of lead page. Cheap "return home"
              affordance since the seller might want to jump back to the
              hero / Pre-Call Brief. */}
          <button onClick={backToTop}
            title="Back to top"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/[0.04] shrink-0"
            style={{ color: C.textMuted }}>
            <ChevronUp size={15} />
          </button>

          {/* Lead identity — name + company, truncated so wide leads don't
              push the actions off-screen on narrow viewports. */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>
              {leadName}
            </p>
            {company && (
              <p className="text-[11px] truncate flex items-center gap-1" style={{ color: C.textMuted }}>
                <Building2 size={10} /> {company}
              </p>
            )}
          </div>

          {/* Actions — same three a seller reaches for during a call:
              dial, draft email, open LinkedIn profile. Mailto and LinkedIn
              are link buttons (no async). Call uses the existing
              CallButton so the Aircall picker + per-tenant rules apply. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {linkedinUrl && (
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
                title="Open LinkedIn profile in a new tab"
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-black/[0.04]"
                style={{ borderColor: C.border, color: "#0A66C2" }}>
                <LinkedInIcon size={12} /> LinkedIn
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`}
                title={`Open mailto:${email} in your mail client`}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-black/[0.04]"
                style={{ borderColor: C.border, color: "#7C3AED" }}>
                <Mail size={12} /> Email
              </a>
            )}
            {phone ? (
              <CallButton phone={phone} leadId={leadId} size="sm" defaultNumberId={aircallNumberId} />
            ) : null}
            <Link href={`/leads/${leadId}`}
              title="Open the dedicated lead page (you're already on it)"
              aria-label="Lead detail link"
              className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-black/[0.04]"
              style={{ color: C.textDim }}>
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
