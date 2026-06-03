"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  HelpCircle, X, PlayCircle, LayoutDashboard, Building2, Bell,
  Sparkles, Send, Users, BarChart3, Plug, Shield, Inbox, Settings,
} from "lucide-react";
import { C } from "@/lib/design";

// Global "?" help menu in the TopHeader. Opens a centered modal that (1) shows
// the intro walkthrough video and (2) explains every view of the app, with a
// click-through link to each. Pure chrome — no backend. Copy is English to
// match the rest of the (largely hardcoded-English) deeper UI.
//
// To wire the Pathway intro Loom: paste the EMBED url below. Loom embed urls
// look like https://www.loom.com/embed/<id>. Empty → a "coming soon" card.
const INTRO_VIDEO_EMBED_URL = "";

type ViewItem = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
  color: string;
};

type ViewGroup = { title: string; items: ViewItem[] };

const GROUPS: ViewGroup[] = [
  {
    title: "Main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, color: C.gold,
        desc: "Your home base — KPIs, today's activity, and a 30-day performance overview at a glance." },
      { href: "/company-bios", label: "Company Bio", icon: Building2, color: C.blue,
        desc: "Your company profile and positioning. This is the context the AI uses to write every message." },
      { href: "/queue", label: "Notifications", icon: Bell, color: "#F97316",
        desc: "Your daily action list: replies to triage, calls to make, and campaign steps awaiting your approval." },
    ],
  },
  {
    title: "Growth Engine",
    items: [
      { href: "/icp", label: "Lead Miner™", icon: Sparkles, color: C.aiAccent,
        desc: "Define your ideal customer profiles (ICPs) and mine matching leads to feed into campaigns." },
      { href: "/campaigns", label: "Outreach Flow™", icon: Send, color: C.aiAccent,
        desc: "Build and run multi-step LinkedIn + email sequences. The AI personalizes each message per lead." },
      { href: "/leads", label: "Leads", icon: Users, color: C.green,
        desc: "Every lead with status, score, and a full activity timeline. Filter, search, and drill into any contact." },
      { href: "/results", label: "Results", icon: BarChart3, color: C.blue,
        desc: "Campaign performance and conversion metrics — what's working, who replied, and where to double down." },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/queue?tab=inbox", label: "Inbox", icon: Inbox, color: C.linkedin,
        desc: "Every conversation across LinkedIn and email in one place. Reply or hand off to a seller." },
      { href: "/accounts", label: "Accounts", icon: Plug, color: C.textMuted,
        desc: "Connected channels and sending accounts (LinkedIn, email, phone) and their health." },
      { href: "/admin", label: "Admin", icon: Shield, color: C.aiAccent,
        desc: "Manage clients, team members, and approvals. Visible to admins and owners only." },
      { href: "/settings", label: "Settings", icon: Settings, color: C.textMuted,
        desc: "Your preferences: theme, language, password, and account details." },
    ],
  },
];

export default function HelpMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const modal = (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border max-h-[88vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 70px -20px rgba(0,0,0,0.45)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold }}>
              <HelpCircle size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                Help &amp; Guide
              </h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>Watch the intro and learn what each view does</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04]">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Intro video */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>Intro video</p>
            {INTRO_VIDEO_EMBED_URL ? (
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: C.border, aspectRatio: "16 / 9" }}>
                <iframe
                  src={INTRO_VIDEO_EMBED_URL}
                  title="Intro walkthrough"
                  allowFullScreen
                  className="w-full h-full"
                  style={{ border: "none" }}
                />
              </div>
            ) : (
              <div className="rounded-xl border flex flex-col items-center justify-center text-center px-6 py-8"
                style={{ borderColor: C.border, backgroundColor: C.bg, aspectRatio: "16 / 9" }}>
                <PlayCircle size={32} style={{ color: C.textDim }} className="mb-2" />
                <p className="text-sm font-semibold" style={{ color: C.textMuted }}>Walkthrough video coming soon</p>
                <p className="text-[11px] mt-1 max-w-sm" style={{ color: C.textDim }}>
                  A short guided tour of the platform will appear here.
                </p>
              </div>
            )}
          </div>

          {/* Views */}
          {GROUPS.map(group => (
            <div key={group.title}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>{group.title}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {group.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/[0.03]"
                      style={{ borderColor: C.border }}
                    >
                      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                        style={{ backgroundColor: `color-mix(in srgb, ${item.color} 14%, transparent)`, color: item.color }}>
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-tight" style={{ color: C.textPrimary }}>{item.label}</p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: C.textMuted }}>{item.desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 text-[11px] shrink-0" style={{ borderColor: C.border, color: C.textDim }}>
          Need a hand? Reach your SWL contact and we&apos;ll walk you through it.
        </div>
      </div>
    </div>
  );

  // Sidebar lives on a dark surface, so the trigger needs white-ish theming
  // that matches the settings gear there; the header trigger stays light.
  const sidebarMuted = "rgba(255,255,255,0.55)";

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          title="Help & guide"
          aria-label="Help & guide"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-[background-color,color] shrink-0"
          style={{ color: sidebarMuted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = sidebarMuted; e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <HelpCircle size={15} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Help & guide"
          aria-label="Help & guide"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
        >
          <HelpCircle size={16} />
        </button>
      )}
      {open && typeof document !== "undefined" && createPortal(modal, document.body)}
    </>
  );
}
