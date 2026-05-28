"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import { Star, Phone, Mail, Share2, Plus, Megaphone, ExternalLink } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type Contact = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  primary_title_role: string | null;
  primary_seniority: string | null;
  primary_work_email: string | null;
  primary_phone: string | null;
  primary_linkedin_url: string | null;
  status: string;
  lead_score: number | null;
  is_priority: boolean;
  allow_linkedin: boolean;
  allow_email: boolean;
  allow_call: boolean;
  current_channel: string | null;
};

type CampaignByLead = Record<string, {
  id: string;
  name: string;
  channel: string | null;
  status: string | null;
}>;

const channelMeta: Record<string, { color: string; label: string }> = {
  linkedin: { color: "#0A66C2", label: "LinkedIn" },
  email:    { color: "#7C3AED", label: "Email" },
  call:     { color: "#F97316", label: "Call" },
  whatsapp: { color: "#25D366", label: "WhatsApp" },
};

const statusMeta: Record<string, { color: string; label: string }> = {
  active:    { color: C.green,    label: "Active" },
  paused:    { color: "#D97706",  label: "Paused" },
  completed: { color: C.textMuted, label: "Completed" },
  failed:    { color: C.red,      label: "Failed" },
};

export default function ContactCards({ contacts, campaignByLead = {} }: { contacts: Contact[]; campaignByLead?: CampaignByLead }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {contacts.map((contact) => {
        const initials = `${(contact.primary_first_name ?? "?")[0]}${(contact.primary_last_name ?? "?")[0]}`.toUpperCase();
        const camp = campaignByLead[contact.id] ?? null;
        const chMeta = camp?.channel ? channelMeta[camp.channel] : null;
        const stMeta = camp?.status ? statusMeta[camp.status] : null;
        const accent = chMeta?.color ?? gold;
        const fullName = `${contact.primary_first_name ?? ""} ${contact.primary_last_name ?? ""}`.trim() || "Unknown";

        return (
          <Link key={contact.id} href={`/leads/${contact.id}`}
            className="group rounded-2xl border overflow-hidden transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-lg relative"
            style={{
              backgroundColor: C.card,
              borderColor: C.border,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>

            {/* Top accent strip — channel color when in a flow, gold otherwise */}
            <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] pointer-events-none"
              style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 60%, transparent))` }} />

            {/* Priority star — corner */}
            {contact.is_priority && (
              <Star size={14} fill={gold} className="absolute top-3 right-3 z-10" style={{ color: gold }} />
            )}

            {/* Header */}
            <div className="p-4 pb-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, white))`,
                    color: "#fff",
                    boxShadow: `0 3px 12px color-mix(in srgb, ${accent} 28%, transparent)`,
                    fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold leading-tight group-hover:underline truncate"
                    style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
                    {fullName}
                  </p>
                  <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: C.textMuted }}>
                    {contact.primary_title_role ?? "—"}
                  </p>
                  {contact.primary_seniority && (
                    <span className="inline-block text-[9px] font-bold uppercase mt-1.5 px-1.5 py-0.5 rounded tracking-wider"
                      style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, color: gold, letterSpacing: "0.08em" }}>
                      {contact.primary_seniority.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Contact rails — icons inline, each a tappable affordance */}
            <div className="px-4 pb-3 flex items-center gap-2.5 text-[11px]" style={{ color: C.textBody }}>
              {contact.primary_work_email && (
                <span className="inline-flex items-center gap-1 truncate min-w-0" title={contact.primary_work_email}>
                  <Mail size={11} className="shrink-0" style={{ color: "#7C3AED" }} />
                  <span className="truncate" style={{ color: C.textMuted }}>{contact.primary_work_email}</span>
                </span>
              )}
              {contact.primary_phone && (
                <span className="inline-flex items-center gap-1 shrink-0">
                  <Phone size={11} style={{ color: "#F97316" }} />
                </span>
              )}
              {contact.primary_linkedin_url && (
                <span className="inline-flex items-center gap-1 shrink-0">
                  <Share2 size={11} style={{ color: "#0A66C2" }} />
                </span>
              )}
              {!contact.primary_phone && !contact.primary_work_email && !contact.primary_linkedin_url && (
                <span className="text-[10px]" style={{ color: C.textDim }}>No contact info</span>
              )}
            </div>

            {/* Flow footer — names the actual campaign + status. Clickable
                surface lifts above the card link via stopPropagation so
                the seller can jump straight to the flow detail. */}
            <div className="border-t px-4 py-3 flex items-center gap-2" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${accent} 4%, ${C.bg})` }}>
              {camp ? (
                <Link href={`/campaigns/${camp.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 inline-flex items-center gap-2 group/flow"
                  title={`${camp.name}${stMeta ? ` · ${stMeta.label}` : ""}`}>
                  <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
                    <Megaphone size={11} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim, letterSpacing: "0.1em" }}>
                      {chMeta?.label ?? "Flow"}
                    </p>
                    <p className="text-[11.5px] font-semibold truncate group-hover/flow:underline" style={{ color: C.textPrimary }}>
                      {camp.name}
                    </p>
                  </div>
                  {stMeta && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${stMeta.color} 14%, transparent)`,
                        color: stMeta.color,
                        border: `1px solid color-mix(in srgb, ${stMeta.color} 28%, transparent)`,
                        letterSpacing: "0.08em",
                      }}>
                      {camp.status === "active" && <span className="inline-block w-1 h-1 rounded-full mr-1 align-middle animate-pulse" style={{ backgroundColor: stMeta.color }} />}
                      {stMeta.label}
                    </span>
                  )}
                  <ExternalLink size={10} style={{ color: C.textDim }} className="shrink-0 opacity-0 group-hover/flow:opacity-100 transition-opacity" />
                </Link>
              ) : (
                <div className="flex-1 inline-flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "color-mix(in srgb, #92400E 12%, transparent)", color: "#92400E" }}>
                    <Megaphone size={11} />
                  </span>
                  <div className="flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#92400E", letterSpacing: "0.1em" }}>No flow</p>
                    <p className="text-[11px]" style={{ color: C.textMuted }}>Not in any outreach yet</p>
                  </div>
                </div>
              )}
            </div>
          </Link>
        );
      })}

      {/* Add Contact placeholder */}
      <div className="rounded-2xl border-2 border-dashed p-5 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors hover:bg-black/[0.02]"
        style={{ borderColor: C.border, minHeight: 200 }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`, border: `1px dashed color-mix(in srgb, ${gold} 35%, transparent)` }}>
          <Plus size={20} style={{ color: gold }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: C.textMuted }}>Add Contact</span>
      </div>
    </div>
  );
}
