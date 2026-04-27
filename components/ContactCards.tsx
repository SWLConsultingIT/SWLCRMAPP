"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import { Star, Phone, Mail, Share2, Plus, CheckCircle } from "lucide-react";

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

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT", color: C.hot, bg: C.hotBg, ring: C.hot };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg, ring: C.warm };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg, ring: C.nurture };
}

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  new:           { label: "NEW",           color: C.blue,      bg: C.blueLight },
  contacted:     { label: "CONTACTED",     color: C.orange,    bg: C.orangeLight },
  connected:     { label: "CONNECTED",     color: C.accent,    bg: C.accentLight },
  responded:     { label: "RESPONDED",     color: C.green,     bg: C.greenLight },
  qualified:     { label: "QUALIFIED",     color: C.green,     bg: C.greenLight },
  proposal_sent: { label: "PROPOSAL SENT", color: C.accent,    bg: C.accentLight },
  closed_won:    { label: "WON",           color: C.green,     bg: C.greenLight },
  closed_lost:   { label: "LOST",          color: C.red,       bg: C.redLight },
  nurturing:     { label: "NURTURING",     color: C.textMuted, bg: "#F3F4F6" },
};

function ScoreRing({ score, color }: { score: number; color: string }) {
  const pct = Math.min(score, 100);
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg width="48" height="48" className="absolute -rotate-90">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="3" />
        <circle cx="24" cy="24" r={radius} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{score}</span>
    </div>
  );
}

export default function ContactCards({ contacts }: { contacts: Contact[] }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {contacts.map((contact) => {
        const score = scoreBadge(contact.lead_score, contact.is_priority);
        const st = statusMap[contact.status] ?? statusMap.new;
        const initials = `${(contact.primary_first_name ?? "?")[0]}${(contact.primary_last_name ?? "?")[0]}`;
        const avatarBg = contact.is_priority || (contact.lead_score && contact.lead_score >= 80)
          ? C.accent : contact.lead_score && contact.lead_score >= 50 ? "#334155" : "#9CA3AF";

        return (
          <Link key={contact.id} href={`/leads/${contact.id}`}
            className="rounded-xl border p-5 transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-md cursor-pointer relative overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: "4px", borderLeftColor: "var(--brand, #c9a83a)" }}>

            {/* Priority star */}
            {contact.is_priority && (
              <Star size={16} fill="#F59E0B" className="absolute top-4 right-4" style={{ color: "#F59E0B" }} />
            )}

            {/* Avatar + Name + Role */}
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ backgroundColor: avatarBg }}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>
                  {contact.primary_first_name} {contact.primary_last_name}
                </p>
                <p className="text-xs truncate" style={{ color: C.textMuted }}>
                  {contact.primary_title_role ?? "—"}
                </p>
                {contact.primary_seniority && (
                  <span className="inline-block text-xs font-medium mt-1 px-2 py-0.5 rounded"
                    style={{ backgroundColor: "#F3F4F6", color: C.textBody, textTransform: "uppercase", fontSize: "10px" }}>
                    {contact.primary_seniority.replace("_", " ")}
                  </span>
                )}
              </div>
            </div>

            {/* Contact details stacked */}
            <div className="space-y-2 mb-4 text-sm" style={{ color: C.textBody }}>
              {contact.primary_phone && (
                <div className="flex items-center gap-2">
                  <Phone size={12} style={{ color: C.phone }} />
                  <span>{contact.primary_phone}</span>
                </div>
              )}
              {contact.primary_work_email && (
                <div className="flex items-center gap-2 truncate">
                  <Mail size={12} className="shrink-0" style={{ color: C.email }} />
                  <span className="truncate">{contact.primary_work_email}</span>
                </div>
              )}
              {contact.primary_linkedin_url && (
                <div className="flex items-center gap-2">
                  <Share2 size={12} style={{ color: C.linkedin }} />
                  <span className="truncate" style={{ color: C.linkedin }}>LinkedIn Profile</span>
                </div>
              )}
              {!contact.primary_phone && !contact.primary_work_email && !contact.primary_linkedin_url && (
                <span className="text-xs" style={{ color: C.textDim }}>No contact info</span>
              )}
            </div>

            {/* Bottom: Campaign type */}
            <div>
              {contact.current_channel && (
                <span className="text-xs font-medium px-2.5 py-1 rounded"
                  style={{ backgroundColor: "#F3F4F6", color: C.textBody, textTransform: "capitalize" }}>
                  {contact.current_channel === "linkedin" ? "LinkedIn Campaign" :
                   contact.current_channel === "email" ? "Email Campaign" :
                   contact.current_channel === "call" ? "Call Campaign" :
                   `${contact.current_channel} Campaign`}
                </span>
              )}
              {!contact.current_channel && (
                <span className="text-xs" style={{ color: C.textDim }}>No campaign</span>
              )}
            </div>
          </Link>
        );
      })}

      {/* Add Contact card */}
      <div className="rounded-xl border-2 border-dashed p-5 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors hover:bg-gray-50"
        style={{ borderColor: "#D1D5DB", minHeight: "200px" }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: "#F3F4F6" }}>
          <Plus size={20} style={{ color: C.textMuted }} />
        </div>
        <span className="text-sm font-medium" style={{ color: C.textMuted }}>Add Contact</span>
      </div>
    </div>
  );
}
