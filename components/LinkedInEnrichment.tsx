"use client";

import { useState } from "react";
import { Link2, ChevronDown, Loader2, RefreshCw, ExternalLink, Briefcase, GraduationCap, Award, Languages as LangIcon, MapPin, Users } from "lucide-react";
import { C } from "@/lib/design";

const LI = "#0A66C2"; // LinkedIn blue

type Experience = { position: string | null; company: string | null; location: string | null; start: string | null; end: string | null; description: string | null; companyPictureUrl: string | null };
type Education = { degree: string | null; school: string | null; start: string | null; end: string | null };
type Profile = {
  firstName: string | null; lastName: string | null; headline: string | null; summary: string | null;
  location: string | null; publicIdentifier: string | null; profileUrl: string | null; profilePictureUrl: string | null;
  connectionsCount: number | null; followerCount: number | null; isPremium: boolean; networkDistance: string | null;
  experience: Experience[]; education: Education[]; skills: Array<{ name: string; endorsements: number }>;
  languages: string[]; certifications: string[];
};

function yr(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? String(d.getFullYear()) : s;
}
function range(a: string | null, b: string | null): string {
  const start = yr(a);
  const end = b ? yr(b) : (a ? "Present" : "");
  return [start, end].filter(Boolean).join(" – ");
}

// LinkedIn Enrichment — fetches the lead's full LinkedIn profile on demand and
// renders it inline: About, full work history with dates, education, skills,
// languages, certifications. Collapsed behind a button so it's an explicit,
// human-paced action (one profile view per click — never automated/batched).
export default function LinkedInEnrichment({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setReason(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/linkedin-profile`);
      const d = await r.json().catch(() => ({}));
      setProfile(d?.profile ?? null);
      setReason(d?.reason ?? (d?.profile ? null : "fetch_failed"));
    } catch {
      setProfile(null);
      setReason("fetch_failed");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load();
  }

  const reasonMsg: Record<string, string> = {
    no_linkedin: "This lead has no LinkedIn profile on file.",
    no_account: "No connected LinkedIn account is available to pull the profile.",
    fetch_failed: "Couldn't reach this profile right now.",
  };

  return (
    <div className="rounded-2xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: `color-mix(in srgb, ${LI} 22%, ${C.border})` }}>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors"
        style={{ backgroundColor: open ? `color-mix(in srgb, ${LI} 7%, transparent)` : "transparent" }}
      >
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: LI }}>
          <Link2 size={17} style={{ color: "#fff" }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold tracking-tight" style={{ color: C.textPrimary }}>LinkedIn Enrichment</p>
          <p className="text-[11px]" style={{ color: C.textMuted }}>
            {loading ? "Pulling the full profile…" : "About, full work history, skills, education"}
          </p>
        </div>
        {loading && <Loader2 size={15} className="animate-spin shrink-0" style={{ color: LI }} />}
        <ChevronDown size={16} className="shrink-0" style={{ color: C.textMuted, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t" style={{ borderColor: C.border }}>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[12px]" style={{ color: C.textMuted }}>
              <Loader2 size={14} className="animate-spin" /> Fetching LinkedIn profile…
            </div>
          ) : profile ? (
            <ProfileView profile={profile} onRefresh={load} />
          ) : (
            <div className="flex items-center justify-between gap-2 py-5">
              <span className="text-[12px]" style={{ color: C.textMuted }}>{reasonMsg[reason ?? "fetch_failed"]}</span>
              {reason === "fetch_failed" && (
                <button onClick={load} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border" style={{ color: LI, borderColor: `color-mix(in srgb, ${LI} 35%, transparent)` }}>
                  <RefreshCw size={11} /> Retry
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileView({ profile: p, onRefresh }: { profile: Profile; onRefresh: () => void }) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return (
    <div className="pt-4">
      {/* Identity */}
      <div className="flex items-start gap-3.5">
        {p.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.profilePictureUrl} alt={name} className="w-14 h-14 rounded-full object-cover shrink-0" style={{ border: `2px solid ${C.border}` }} />
        ) : (
          <span className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 text-[16px] font-bold" style={{ backgroundColor: `color-mix(in srgb, ${LI} 14%, transparent)`, color: LI }}>
            {(name || "··").slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-bold" style={{ color: C.textPrimary }}>{name || "—"}</p>
            {p.isPremium && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: "color-mix(in srgb, #D97706 16%, transparent)", color: "#92400E" }}>Premium</span>}
            {p.networkDistance && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>{p.networkDistance.replace("_", " ")}</span>}
          </div>
          {p.headline && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: C.textBody }}>{p.headline}</p>}
          <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: C.textMuted }}>
            {p.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {p.location}</span>}
            {p.connectionsCount != null && <span className="inline-flex items-center gap-1"><Users size={11} /> {p.connectionsCount}+ connections</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {p.profileUrl && (
            <a href={p.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg" style={{ color: LI, backgroundColor: `color-mix(in srgb, ${LI} 10%, transparent)` }}>
              View <ExternalLink size={11} />
            </a>
          )}
          <button onClick={onRefresh} title="Refresh from LinkedIn" className="inline-flex items-center justify-center w-8 h-8 rounded-lg" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* About */}
      {p.summary && (
        <Section title="About">
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{p.summary}</p>
        </Section>
      )}

      {/* Experience — full history with dates */}
      {p.experience.length > 0 && (
        <Section title="Experience" icon={Briefcase}>
          <ol className="space-y-3">
            {p.experience.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: LI }} />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold" style={{ color: C.textPrimary }}>{[e.position, e.company].filter(Boolean).join(" · ")}</p>
                  <p className="text-[10.5px]" style={{ color: C.textMuted }}>{[range(e.start, e.end), e.location].filter(Boolean).join(" · ")}</p>
                  {e.description && <p className="text-[11.5px] mt-1 leading-snug whitespace-pre-line" style={{ color: C.textBody }}>{e.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Education */}
      {p.education.length > 0 && (
        <Section title="Education" icon={GraduationCap}>
          <ul className="space-y-1.5">
            {p.education.map((e, i) => (
              <li key={i}>
                <p className="text-[12px] font-semibold" style={{ color: C.textPrimary }}>{e.school ?? "—"}</p>
                <p className="text-[10.5px]" style={{ color: C.textMuted }}>{[e.degree, range(e.start, e.end)].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Skills */}
      {p.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map((s, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${LI} 9%, transparent)`, color: LI }}>
                {s.name}{s.endorsements > 0 ? ` · ${s.endorsements}` : ""}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Languages + Certifications */}
      {p.languages.length > 0 && (
        <Section title="Languages" icon={LangIcon}>
          <p className="text-[12px]" style={{ color: C.textBody }}>{p.languages.join(", ")}</p>
        </Section>
      )}
      {p.certifications.length > 0 && (
        <Section title="Certifications" icon={Award}>
          <ul className="space-y-1">
            {p.certifications.map((c, i) => <li key={i} className="text-[12px]" style={{ color: C.textBody }}>{c}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; children: React.ReactNode }) {
  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: C.border }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5" style={{ color: C.textMuted, letterSpacing: "0.08em" }}>
        {Icon && <Icon size={12} style={{ color: C.textMuted }} />} {title}
      </p>
      {children}
    </div>
  );
}
