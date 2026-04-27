"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import {
  Building2, Save, AlertCircle, Plus, X, Pencil, Globe, Loader2,
  MapPin, Award, Briefcase, Trash2, Upload, Image as ImageIcon,
  FileText, Download, File, ChevronDown,
} from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

const LANGUAGES = [
  { code: "EN", flag: "🇺🇸" },
  { code: "IT", flag: "🇮🇹" },
  { code: "ES", flag: "🇪🇸" },
  { code: "FR", flag: "🇫🇷" },
  { code: "DE", flag: "🇩🇪" },
];

type CaseStudy = { title: string; description: string; url?: string; file_url?: string };
type Resource = { name: string; file_url: string; type: string };

type CompanyBio = {
  id?: string;
  company_name: string;
  tagline: string;
  industry: string;
  description: string;
  value_proposition: string;
  main_services: string[];
  target_market: string;
  differentiators: string;
  website: string;
  linkedin_url: string;
  instagram_url: string;
  twitter_url: string;
  facebook_url: string;
  youtube_url: string;
  tiktok_url: string;
  founded_year: number | null;
  team_size: string;
  location: string;
  tone_of_voice: string;
  languages: string[];
  certifications: string[];
  key_clients: string[];
  case_studies: CaseStudy[];
  logo_url: string;
  resources: Resource[];
};

const empty: CompanyBio = {
  company_name: "", tagline: "", industry: "", description: "", value_proposition: "",
  main_services: [], target_market: "", differentiators: "", website: "",
  linkedin_url: "", instagram_url: "", twitter_url: "", facebook_url: "", youtube_url: "", tiktok_url: "",
  founded_year: null, team_size: "", location: "", tone_of_voice: "", languages: [], certifications: [],
  key_clients: [], case_studies: [], logo_url: "", resources: [],
};

// ─── File upload helper ─────────────────────────────────
async function uploadFile(file: globalThis.File, folder: string): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  const ext = file.name.split(".").pop();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("company-assets").upload(path, file);
  if (error) return null;
  const { data: { publicUrl } } = supabase.storage.from("company-assets").getPublicUrl(path);
  return publicUrl;
}

function fileIcon(url: string) {
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)) return ImageIcon;
  if (/\.pdf$/i.test(url)) return FileText;
  return File;
}

function fileName(url: string) {
  try { return decodeURIComponent(url.split("/").pop()?.replace(/^\d+-[a-z0-9]+\./, "") ?? "File"); } catch { return "File"; }
}

// ─── Reusable: Social icon SVGs ──────────────────────────
function LinkedInIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;
}
function InstagramIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>;
}
function TwitterIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
}
function FacebookIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
}
function YouTubeIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>;
}
function TikTokIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>;
}

const socialLinks = [
  { key: "linkedin_url", label: "LinkedIn", icon: LinkedInIcon, color: "#0A66C2" },
  { key: "instagram_url", label: "Instagram", icon: InstagramIcon, color: "#E4405F" },
  { key: "twitter_url", label: "X (Twitter)", icon: TwitterIcon, color: "#000000" },
  { key: "facebook_url", label: "Facebook", icon: FacebookIcon, color: "#1877F2" },
  { key: "youtube_url", label: "YouTube", icon: YouTubeIcon, color: "#FF0000" },
  { key: "tiktok_url", label: "TikTok", icon: TikTokIcon, color: "#000000" },
] as const;

// ─── Tag Input ───────────────────────────────────────────
function TagList({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  function add() {
    const s = input.trim();
    if (!s || values.includes(s)) return;
    onChange([...values, s]);
    setInput("");
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)` }}>
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="opacity-60 hover:opacity-100"><X size={10} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          placeholder={placeholder} />
        <button onClick={add} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)` }}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── VIEW MODE (leads detail style) ─────────────────────
type LeadSummary = { id: string; primary_first_name: string; primary_last_name: string; company_name: string; status: string; current_channel: string; lead_score: number | null };
type CampaignGroup = { name: string; channel: string; status: string; leads: (LeadSummary & { campaign_status?: string })[] };

function BioView({ bio, onEdit }: { bio: CompanyBio; onEdit: () => void }) {
  const [campaignGroups, setCampaignGroups] = useState<CampaignGroup[]>([]);
  const [uncampaignedLeads, setUncampaignedLeads] = useState<LeadSummary[]>([]);
  const [leadStats, setLeadStats] = useState({ total: 0, active: 0, responded: 0, qualified: 0 });
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!bio.id) return;
    async function fetchLeads() {
  const supabase = getSupabaseBrowser();
      const [{ data: allLeads, count }, { data: campaigns }] = await Promise.all([
        supabase.from("leads")
          .select("id, primary_first_name, primary_last_name, company_name, status, current_channel, lead_score", { count: "exact" })
          .eq("company_bio_id", bio.id).order("updated_at", { ascending: false }),
        supabase.from("campaigns")
          .select("id, name, channel, status, lead_id")
          .in("status", ["active", "paused", "completed"]),
      ]);
      const leads = allLeads ?? [];
      setLeadStats({
        total: count ?? 0,
        active: leads.filter(l => ["new", "contacted", "connected"].includes(l.status)).length,
        responded: leads.filter(l => l.status === "responded").length,
        qualified: leads.filter(l => ["qualified", "proposal_sent", "closed_won"].includes(l.status)).length,
      });

      // Group leads by campaign
      const campByLead: Record<string, any> = {};
      for (const c of campaigns ?? []) { campByLead[c.lead_id] = c; }

      const groups: Record<string, CampaignGroup> = {};
      const noCamp: LeadSummary[] = [];
      for (const lead of leads) {
        const camp = campByLead[lead.id];
        if (camp) {
          const key = camp.name ?? "Unnamed";
          if (!groups[key]) groups[key] = { name: key, channel: camp.channel, status: camp.status, leads: [] };
          groups[key].leads.push({ ...lead, campaign_status: camp.status });
        } else {
          noCamp.push(lead);
        }
      }
      setCampaignGroups(Object.values(groups));
      setUncampaignedLeads(noCamp);
    }
    fetchLeads();
  }, [bio.id]);

  const activeSocials = socialLinks.filter(s => bio[s.key]);
  const metricItems = [
    bio.industry && { label: "Industry", value: bio.industry },
    bio.team_size && { label: "Team", value: bio.team_size },
    bio.founded_year && { label: "Founded", value: String(bio.founded_year) },
    bio.languages?.length > 0 && { label: "Languages", value: bio.languages.join(", ") },
  ].filter(Boolean) as { label: string; value: string }[];

  const statusColors: Record<string, { color: string; bg: string }> = {
    new: { color: C.blue, bg: C.blueLight },
    contacted: { color: C.orange, bg: C.orangeLight },
    connected: { color: C.accent, bg: C.accentLight },
    responded: { color: C.green, bg: C.greenLight },
    qualified: { color: C.green, bg: C.greenLight },
    closed_won: { color: C.green, bg: C.greenLight },
    closed_lost: { color: C.red, bg: C.redLight },
  };

  return (
    <div className="space-y-6">
      {/* ═══ MAIN CARD (like leads detail) ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>

        {/* Top row: Logo + Name + Edit */}
        <div className="p-6 flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            {bio.logo_url ? (
              <img src={bio.logo_url} alt="" className="w-16 h-16 rounded-xl object-contain border shrink-0 p-1.5" style={{ borderColor: C.border, backgroundColor: "#ffffff" }} />
            ) : (
              <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold shrink-0"
                style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                {bio.company_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{bio.company_name}</h2>
              <div className="flex items-center gap-2 mt-1.5">
                {bio.tagline ? (
                  <span className="text-sm italic" style={{ color: C.accent }}>{bio.tagline}</span>
                ) : bio.industry ? (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: C.textBody }}>
                    <Briefcase size={13} style={{ color: gold }} /> {bio.industry}
                  </span>
                ) : null}
                {bio.location && (
                  <>
                    <span className="text-sm" style={{ color: C.textDim }}>·</span>
                    <span className="flex items-center gap-1 text-sm" style={{ color: C.textMuted }}>
                      <MapPin size={12} /> {bio.location}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80 shrink-0"
            style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
            <Pencil size={12} /> Edit
          </button>
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Metrics row */}
        {metricItems.length > 0 && (
          <>
            <div className="px-6 py-4 grid grid-cols-4 gap-4">
              {metricItems.map(m => (
                <div key={m.label}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{m.label}</p>
                  <p className="text-lg font-bold" style={{ color: C.textPrimary }}>{m.value}</p>
                </div>
              ))}
            </div>
            <div className="border-t" style={{ borderColor: C.border }} />
          </>
        )}

        {/* Services bar */}
        {bio.main_services?.length > 0 && (
          <div className="mx-6 my-4 px-5 py-3 rounded-lg" style={{ backgroundColor: goldLight, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 20%, transparent)` }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: gold }}>{bio.main_services.length} Services</p>
            <div className="flex flex-wrap gap-1.5">
              {bio.main_services.map((s, i) => (
                <span key={i} className="text-xs font-medium px-2.5 py-1 rounded-md"
                  style={{ backgroundColor: "rgba(255,255,255,0.7)", color: C.textBody }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Online Presence (social buttons like leads page) */}
        {(bio.website || activeSocials.length > 0) && (
          <div className="px-6 pb-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Online Presence</h3>
            <div className="grid grid-cols-4 gap-2.5">
              {bio.website && (
                <a href={bio.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-3 rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-90 hover:shadow-md"
                  style={{ backgroundColor: C.accent }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
                    <Globe size={18} color="#fff" />
                  </div>
                  <span className="text-sm font-semibold text-white truncate">
                    {bio.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  </span>
                </a>
              )}
              {activeSocials.map(({ key, label, icon: Icon, color }) => (
                <a key={key} href={bio[key]} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-3 rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-90 hover:shadow-md"
                  style={{ backgroundColor: color }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
                    <div className="[&_svg]:fill-white [&_svg_path]:fill-white"><Icon size={18} /></div>
                  </div>
                  <span className="text-sm font-semibold text-white">{label}</span>
                </a>
              ))}
              {/* Empty slots */}
              {socialLinks.filter(s => !bio[s.key]).map(({ key, label, icon: Icon }) => (
                <div key={key} className="flex items-center gap-3 px-3 py-3 rounded-lg border"
                  style={{ borderColor: "#E5E7EB", backgroundColor: C.cardHov }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 grayscale opacity-30" style={{ backgroundColor: "white" }}>
                    <Icon size={18} />
                  </div>
                  <span className="text-sm font-medium" style={{ color: "#D1D5DB" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ ROW 1: About the Company (full width) ═══ */}
      {(bio.description || bio.value_proposition) && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>About the Company</h3>
          {bio.description && (
            <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{bio.description}</p>
          )}
          {bio.value_proposition && (
            <div className="rounded-lg border p-3.5 mt-4" style={{ borderColor: C.border, backgroundColor: C.cardHov }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Value Proposition</p>
              <p className="text-sm italic" style={{ color: C.accent }}>"{bio.value_proposition}"</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ ROW 2: Differentiators (3) + Market & Tone (2) ═══ */}
      {(bio.differentiators || bio.target_market || bio.tone_of_voice) && (
        <div className="grid grid-cols-5 gap-6">
          {bio.differentiators && (
            <div className="col-span-3 rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Differentiators</h3>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{bio.differentiators}</p>
            </div>
          )}
          {(bio.target_market || bio.tone_of_voice) && (
            <div className={`${bio.differentiators ? "col-span-2" : "col-span-5"} rounded-xl border p-6`} style={{ backgroundColor: C.card, borderColor: C.border }}>
              {bio.target_market && (
                <div className={bio.tone_of_voice ? "mb-4" : ""}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Target Market</h3>
                  <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{bio.target_market}</p>
                </div>
              )}
              {bio.tone_of_voice && (
                <div className={bio.target_market ? "pt-4 border-t" : ""} style={{ borderColor: C.border }}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: gold }}>Tone of Voice</h3>
                  <p className="text-sm" style={{ color: C.textBody }}>{bio.tone_of_voice}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Track Record (clients + certs + cases unified) ═══ */}
      {(bio.key_clients?.length > 0 || bio.certifications?.length > 0 || bio.case_studies?.length > 0) && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-sm font-bold mb-5" style={{ color: C.textPrimary }}>Track Record</h3>

          <div className="space-y-5">
            {/* Clients */}
            {bio.key_clients?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: gold }}>Key Clients</p>
                <div className="flex flex-wrap gap-1.5">
                  {bio.key_clients.map((c, i) => (
                    <span key={i} className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ backgroundColor: C.blueLight, color: C.blue }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Certifications */}
            {bio.certifications?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: gold }}>
                  <Award size={12} /> Certifications & Awards
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {bio.certifications.map((c, i) => (
                    <span key={i} className="text-xs font-medium px-2.5 py-1 rounded-md"
                      style={{ backgroundColor: C.greenLight, color: C.green }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Case Studies */}
            {bio.case_studies?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>Case Studies / Portfolio</p>
                <div className="grid grid-cols-3 gap-3">
                  {bio.case_studies.map((cs, i) => (
                    <div key={i} className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.cardHov }}>
                      <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>{cs.title}</p>
                      <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>{cs.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        {cs.url && (
                          <a href={cs.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-medium" style={{ color: C.accent }}>Read more →</a>
                        )}
                        {cs.file_url && (() => {
                          const Icon = fileIcon(cs.file_url);
                          return (
                            <a href={cs.file_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
                              style={{ backgroundColor: C.accentLight, color: C.accent }}>
                              <Icon size={11} /> Attachment
                            </a>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Resources ═══ */}
      {bio.resources?.length > 0 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Resources</h3>
          <div className="grid grid-cols-4 gap-3">
            {bio.resources.map((r, i) => {
              const Icon = fileIcon(r.file_url);
              return (
                <a key={i} href={r.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                  style={{ borderColor: C.border, backgroundColor: C.cardHov }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentLight }}>
                    <Icon size={16} style={{ color: C.accent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: C.textPrimary }}>{r.name}</p>
                    <p className="text-xs" style={{ color: C.textDim }}>{r.type}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Leads by Campaign ═══ */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-6 py-4 flex items-center justify-between border-b"
          style={{ borderColor: C.border, background: `linear-gradient(90deg, color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent) 0%, transparent 50%)` }}>
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Leads & Campaigns</h3>
            {leadStats.total > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: goldLight, color: gold }}>
                {leadStats.total}
              </span>
            )}
          </div>
          <Link href="/leads" className="text-xs font-semibold" style={{ color: gold }}>View All</Link>
        </div>

        {campaignGroups.length === 0 && uncampaignedLeads.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>No leads linked to this company yet.</p>
            <p className="text-xs mt-1" style={{ color: C.textDim }}>
              Leads will appear here once they are imported and assigned.
            </p>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <div className="px-6 py-3 flex items-center gap-6 border-b" style={{ borderColor: C.border, backgroundColor: C.cardHov }}>
              {[
                { label: "Total", value: leadStats.total, color: C.textPrimary },
                { label: "Active", value: leadStats.active, color: C.blue },
                { label: "Responded", value: leadStats.responded, color: C.green },
                { label: "Qualified", value: leadStats.qualified, color: C.accent },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ color: s.color }}>{s.value}</span>
                  <span className="text-xs" style={{ color: C.textMuted }}>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Campaign groups */}
            {campaignGroups.map(group => {
              const isOpen = expandedGroup === group.name;
              const chColors: Record<string, string> = { linkedin: "#0A66C2", email: "#7C3AED", call: "#F97316" };
              const chColor = chColors[group.channel] ?? gold;
              const campSt = group.status === "active" ? { color: C.green, bg: C.greenLight, label: "Active" }
                : group.status === "paused" ? { color: "#D97706", bg: "#FFFBEB", label: "Paused" }
                : { color: C.textMuted, bg: "#F3F4F6", label: group.status };
              return (
                <div key={group.name}>
                  <button onClick={() => setExpandedGroup(isOpen ? null : group.name)}
                    className="flex items-center gap-3 w-full px-6 py-3 border-b text-left transition-colors hover:bg-gray-50"
                    style={{ borderColor: C.border }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${chColor}12` }}>
                      <span className="text-xs font-bold" style={{ color: chColor }}>{group.channel?.[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{group.name}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: campSt.bg, color: campSt.color }}>
                      {campSt.label}
                    </span>
                    <span className="text-xs" style={{ color: C.textMuted }}>{group.leads.length} leads</span>
                    <ChevronDown size={14} style={{ color: C.textDim, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  {isOpen && group.leads.map(lead => {
                    const st = statusColors[lead.status] ?? { color: C.textMuted, bg: "#F3F4F6" };
                    return (
                      <Link key={lead.id} href={`/leads/${lead.id}`}
                        className="flex items-center gap-4 px-6 pl-16 py-2.5 border-b table-row-hover"
                        style={{ borderColor: C.border }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                          {(lead.primary_first_name?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                            {lead.primary_first_name} {lead.primary_last_name}
                          </p>
                          <p className="text-xs truncate" style={{ color: C.textMuted }}>{lead.company_name}</p>
                        </div>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize"
                          style={{ backgroundColor: st.bg, color: st.color }}>
                          {lead.status?.replace("_", " ")}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}

            {/* Uncampaigned leads */}
            {uncampaignedLeads.length > 0 && (
              <div>
                <button onClick={() => setExpandedGroup(expandedGroup === "__none" ? null : "__none")}
                  className="flex items-center gap-3 w-full px-6 py-3 border-b text-left transition-colors hover:bg-gray-50"
                  style={{ borderColor: C.border }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${C.blue}12` }}>
                    <span className="text-xs font-bold" style={{ color: C.blue }}>?</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>No Campaign Assigned</p>
                  </div>
                  <span className="text-xs" style={{ color: C.textMuted }}>{uncampaignedLeads.length} leads</span>
                  <ChevronDown size={14} style={{ color: C.textDim, transform: expandedGroup === "__none" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                {expandedGroup === "__none" && uncampaignedLeads.map(lead => {
                  const st = statusColors[lead.status] ?? { color: C.textMuted, bg: "#F3F4F6" };
                  return (
                    <Link key={lead.id} href={`/leads/${lead.id}`}
                      className="flex items-center gap-4 px-6 pl-16 py-2.5 border-b table-row-hover"
                      style={{ borderColor: C.border }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                        {(lead.primary_first_name?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>
                          {lead.primary_first_name} {lead.primary_last_name}
                        </p>
                        <p className="text-xs truncate" style={{ color: C.textMuted }}>{lead.company_name}</p>
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize"
                        style={{ backgroundColor: st.bg, color: st.color }}>
                        {lead.status?.replace("_", " ")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── EDIT MODE ───────────────────────────────────────────
const industryOptions = [
  "Technology / SaaS", "Consulting", "Marketing / Advertising", "Fintech", "E-commerce",
  "Healthcare / Healthtech", "Education / Edtech", "Manufacturing", "Real Estate", "Logistics",
  "Legal", "Accounting / Finance", "Human Resources", "Insurance", "Energy",
  "Food & Beverage", "Retail", "Telecommunications", "Automotive", "Other",
];

const teamSizeOptions = ["1-5", "6-10", "11-25", "26-50", "51-100", "101-250", "251-500", "500+"];

const languageOptions = ["Spanish", "English", "Portuguese", "French", "German", "Italian", "Chinese", "Japanese", "Korean", "Arabic", "Hindi"];

function BioForm({ bio, onSave, onCancel, onDelete, isNew }: { bio: CompanyBio; onSave: (b: CompanyBio) => void; onCancel: () => void; onDelete?: () => void; isNew: boolean }) {
  const [form, setForm] = useState<CompanyBio>(bio);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newService, setNewService] = useState("");

  function addService() {
    const s = newService.trim();
    if (!s) return;
    setForm(f => ({ ...f, main_services: [...(f.main_services ?? []), s] }));
    setNewService("");
  }

  function addCaseStudy() {
    setForm(f => ({ ...f, case_studies: [...(f.case_studies ?? []), { title: "", description: "", url: "" }] }));
  }

  function updateCaseStudy(i: number, field: keyof CaseStudy, value: string) {
    setForm(f => {
      const cs = [...(f.case_studies ?? [])];
      cs[i] = { ...cs[i], [field]: value };
      return { ...f, case_studies: cs };
    });
  }

  function removeCaseStudy(i: number) {
    setForm(f => ({ ...f, case_studies: (f.case_studies ?? []).filter((_, idx) => idx !== i) }));
  }

  async function handleSave() {
  const supabase = getSupabaseBrowser();
    setSaving(true);
    setError(null);
    const payload = { ...form, updated_at: new Date().toISOString() };
    let result;
    if (form.id) {
      result = await supabase.from("company_bios").update(payload).eq("id", form.id).select().single();
    } else {
      result = await supabase.from("company_bios").insert(payload).select().single();
    }
    if (result.error) { setError(result.error.message); setSaving(false); }
    else { onSave(result.data); }
  }

  return (
    <div className="space-y-6">
      {/* 1. Company info */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Company Information</h2>
        <div className="grid grid-cols-2 gap-4">
          {/* Logo upload */}
          <div className="col-span-2 flex items-center gap-5 pb-4 mb-2 border-b" style={{ borderColor: C.border }}>
            {form.logo_url ? (
              <img src={form.logo_url} alt="" className="w-20 h-20 rounded-xl object-contain border p-1.5" style={{ borderColor: C.border, backgroundColor: "#ffffff" }} />
            ) : (
              <div className="w-20 h-20 rounded-xl flex items-center justify-center border-2 border-dashed"
                style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <ImageIcon size={24} style={{ color: C.textDim }} />
              </div>
            )}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: C.textBody }}>Company Logo</p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80"
                  style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
                  <Upload size={12} /> Upload
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = await uploadFile(file, "logos");
                    if (url) setForm(f => ({ ...f, logo_url: url }));
                  }} />
                </label>
                {form.logo_url && (
                  <button onClick={() => setForm(f => ({ ...f, logo_url: "" }))}
                    className="text-xs px-2 py-1.5 rounded-lg" style={{ color: C.red, backgroundColor: C.redLight }}>
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>PNG, JPG. Max 2MB.</p>
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Company name *</label>
            <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
              placeholder="E.g.: SWL Consulting" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Tagline / slogan</label>
            <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
              placeholder="Short phrase that defines the company" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Industry</label>
            <select className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: form.industry ? C.textPrimary : C.textDim, backgroundColor: C.bg }}
              value={industryOptions.includes(form.industry) ? form.industry : form.industry ? "__custom" : ""}
              onChange={e => {
                if (e.target.value === "__custom") return;
                setForm(f => ({ ...f, industry: e.target.value }));
              }}>
              <option value="">Select industry</option>
              {industryOptions.map(o => <option key={o} value={o}>{o}</option>)}
              {form.industry && !industryOptions.includes(form.industry) && (
                <option value="__custom">{form.industry} (custom)</option>
              )}
            </select>
            {form.industry && !industryOptions.includes(form.industry) ? null : (
              <input className="w-full rounded-lg border px-3.5 py-2 text-xs focus:outline-none mt-2"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={industryOptions.includes(form.industry) ? "" : form.industry}
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="Or type a custom industry…" />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Location</label>
            <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="Buenos Aires, Argentina" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Year Founded</label>
            <input type="number" className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.founded_year ?? ""} onChange={e => setForm(f => ({ ...f, founded_year: e.target.value ? Number(e.target.value) : null }))}
              placeholder="2020" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Team Size</label>
            <select className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: form.team_size ? C.textPrimary : C.textDim, backgroundColor: C.bg }}
              value={form.team_size}
              onChange={e => setForm(f => ({ ...f, team_size: e.target.value }))}>
              <option value="">Select</option>
              {teamSizeOptions.map(o => <option key={o} value={o}>{o} people</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 2. Services */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Main Services</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {(form.main_services ?? []).map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
              {s}
              <button onClick={() => setForm(f => ({ ...f, main_services: f.main_services.filter((_, idx) => idx !== i) }))} className="ml-0.5 opacity-60 hover:opacity-100"><X size={11} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="flex-1 rounded-lg border px-3.5 py-2 text-sm focus:outline-none"
            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={newService} onChange={e => setNewService(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addService()}
            placeholder="Add service…" />
          <button onClick={addService}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* 3. Online — Links (moved before pitch) */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Links & Social Media</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Website</label>
            <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://swlconsulting.com" />
          </div>
          {socialLinks.map(({ key, label, icon: Icon, color }) => (
            <div key={key}>
              <label className="text-xs font-medium mb-1.5 flex items-center gap-1.5" style={{ color: C.textBody }}>
                <span style={{ color }}><Icon size={12} /></span> {label}
              </label>
              <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none mt-1"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={`${label} URL`} />
            </div>
          ))}
        </div>
      </div>

      {/* 4. Your pitch */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Value Proposition</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Company Description</label>
            <textarea rows={4} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does the company do, its mission, how many years, etc." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Value proposition</label>
            <textarea rows={2} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.value_proposition} onChange={e => setForm(f => ({ ...f, value_proposition: e.target.value }))}
              placeholder="In one sentence: what problem does it solve and for whom" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Differentiators</label>
            <textarea rows={2} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.differentiators} onChange={e => setForm(f => ({ ...f, differentiators: e.target.value }))}
              placeholder="What makes this company different from the competition" />
          </div>
        </div>
      </div>

      {/* 5. Target audience & communication */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Target Audience & Communication</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Tone of Voice</label>
            <textarea rows={2} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.tone_of_voice} onChange={e => setForm(f => ({ ...f, tone_of_voice: e.target.value }))}
              placeholder="Professional yet approachable. Direct, no corporate jargon. Trustworthy." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Languages</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {languageOptions.map(lang => {
                const selected = (form.languages ?? []).includes(lang);
                return (
                  <button key={lang} type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      languages: selected ? (f.languages ?? []).filter(l => l !== lang) : [...(f.languages ?? []), lang],
                    }))}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-[opacity,transform,box-shadow,background-color,border-color]"
                    style={selected
                      ? { backgroundColor: gold, color: "#04070d" }
                      : { backgroundColor: "#F3F4F6", color: C.textMuted, border: `1px solid ${C.border}` }
                    }>
                    {lang}
                  </button>
                );
              })}
            </div>
            <TagList
              values={(form.languages ?? []).filter(l => !languageOptions.includes(l))}
              onChange={custom => setForm(f => ({ ...f, languages: [...(f.languages ?? []).filter(l => languageOptions.includes(l)), ...custom] }))}
              placeholder="Add another language…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Target market</label>
            <textarea rows={3} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={form.target_market} onChange={e => setForm(f => ({ ...f, target_market: e.target.value }))}
              placeholder="Ideal client type, industry, company size, geography, etc." />
          </div>
        </div>
      </div>

      {/* 6. Track Record (clients + certs + cases) */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Track Record</h2>
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Key Clients</label>
            <TagList values={form.key_clients ?? []} onChange={v => setForm(f => ({ ...f, key_clients: v }))} placeholder="Client name…" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Certifications / Awards</label>
            <TagList values={form.certifications ?? []} onChange={v => setForm(f => ({ ...f, certifications: v }))} placeholder="Google Partner, ISO 9001…" />
          </div>
          <div className="pt-4 border-t" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-xs font-medium" style={{ color: C.textBody }}>Case Studies / Portfolio</label>
              <button onClick={addCaseStudy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)` }}>
                <Plus size={12} /> Add case
              </button>
            </div>
            {(form.case_studies ?? []).length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: C.textDim }}>
                Add case studies to provide more context for outreach messages.
              </p>
            ) : (
              <div className="space-y-3">
                {(form.case_studies ?? []).map((cs, i) => (
                  <div key={i} className="rounded-lg border p-4 relative" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <button onClick={() => removeCaseStudy(i)} className="absolute top-3 right-3 opacity-40 hover:opacity-100" style={{ color: C.red }}>
                      <Trash2 size={13} />
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Title</label>
                        <input className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                          value={cs.title} onChange={e => updateCaseStudy(i, "title", e.target.value)}
                          placeholder="E.g.: CRM Implementation for Fintech" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Link (optional)</label>
                        <input className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                          value={cs.url ?? ""} onChange={e => updateCaseStudy(i, "url", e.target.value)}
                          placeholder="https://..." />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Description</label>
                        <textarea rows={2} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                          value={cs.description} onChange={e => updateCaseStudy(i, "description", e.target.value)}
                          placeholder="Brief summary of the case and results" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Attachment</label>
                        {cs.file_url ? (
                          <div className="flex items-center gap-2">
                            <a href={cs.file_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg"
                              style={{ backgroundColor: C.accentLight, color: C.accent }}>
                              <FileText size={12} /> View file
                            </a>
                            <button onClick={() => updateCaseStudy(i, "file_url", "")}
                              className="text-xs px-2 py-1.5 rounded-lg" style={{ color: C.red, backgroundColor: C.redLight }}>
                              Remove
                            </button>
                          </div>
                        ) : (
                          <label className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80"
                            style={{ backgroundColor: "#F3F4F6", color: C.textMuted, border: `1px solid ${C.border}` }}>
                            <Upload size={12} /> Upload PDF / Image
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const url = await uploadFile(file, "case-studies");
                              if (url) updateCaseStudy(i, "file_url", url);
                            }} />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 7. Resources */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Resources</h2>
          <label className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80"
            style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)` }}>
            <Upload size={12} /> Upload file
            <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const url = await uploadFile(file, "resources");
              if (url) {
                const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
                const type = ["pdf"].includes(ext) ? "PDF" : ["doc","docx"].includes(ext) ? "Document" : ["ppt","pptx"].includes(ext) ? "Presentation" : ["xls","xlsx"].includes(ext) ? "Spreadsheet" : "Image";
                setForm(f => ({ ...f, resources: [...(f.resources ?? []), { name: file.name, file_url: url, type }] }));
              }
            }} />
          </label>
        </div>
        <p className="text-xs mb-3" style={{ color: C.textDim }}>
          Pitch decks, brochures, brand guidelines, or any reference material for outreach.
        </p>
        {(form.resources ?? []).length === 0 ? (
          <div className="border-2 border-dashed rounded-lg py-6 text-center" style={{ borderColor: C.border }}>
            <Upload size={20} className="mx-auto mb-2" style={{ color: C.textDim }} />
            <p className="text-xs" style={{ color: C.textDim }}>Drop files here or click "Upload file"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(form.resources ?? []).map((r, i) => {
              const Icon = fileIcon(r.file_url);
              return (
                <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: C.accentLight }}>
                    <Icon size={16} style={{ color: C.accent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{r.name}</p>
                    <p className="text-xs" style={{ color: C.textMuted }}>{r.type}</p>
                  </div>
                  <a href={r.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium px-2 py-1 rounded" style={{ color: C.accent }}>
                    <Download size={13} />
                  </a>
                  <button onClick={() => setForm(f => ({ ...f, resources: (f.resources ?? []).filter((_, idx) => idx !== i) }))}
                    className="opacity-40 hover:opacity-100" style={{ color: C.red }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !form.company_name}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? "Saving…" : "Save"}
          </button>
          {!isNew && (
            <button onClick={onCancel}
              className="rounded-lg px-5 py-2.5 text-sm font-medium"
              style={{ color: C.textMuted, backgroundColor: "#F3F4F6" }}>
              Cancel
            </button>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: C.red }}>
              <AlertCircle size={15} /> {error}
            </span>
          )}
        </div>

        {!isNew && onDelete && (
          !confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ color: C.red }}>
              <Trash2 size={13} /> Delete company
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: C.red }}>Are you sure?</span>
              <button onClick={async () => {
                setDeleting(true);
                const supabase = getSupabaseBrowser();
                await supabase.from("company_bios").delete().eq("id", form.id!);
                onDelete();
              }}
                disabled={deleting}
                className="rounded-lg px-4 py-2 text-xs font-semibold"
                style={{ backgroundColor: C.red, color: "#fff" }}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-3 py-2 text-xs font-medium"
                style={{ color: C.textMuted, backgroundColor: "#F3F4F6" }}>
                No
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────
export default function CompanyBiosPage() {
  const [bio, setBio] = useState<CompanyBio | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scanLang, setScanLang] = useState("EN");
  const [prefilled, setPrefilled] = useState<CompanyBio | null>(null);

  async function handleScrape() {
    if (!scrapeUrl.trim()) return;
    setScraping(true);
    setScrapeError(null);
    try {
      let finalUrl = scrapeUrl.trim();
      if (!finalUrl.startsWith("http")) finalUrl = "https://" + finalUrl;
      const res = await fetch("/api/company-bios/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: finalUrl, lang: scanLang }),
      });
      const data = await res.json();
      if (!res.ok) { setScrapeError(data.error ?? "Failed to scrape"); return; }
      setPrefilled({ ...empty, ...data });
      setEditing(true);
    } catch {
      setScrapeError("Could not connect to the website");
    } finally {
      setScraping(false);
    }
  }

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("company_bios")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data) setBio(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}><Loader2 size={20} className="animate-spin mr-2" /> Loading…</div>;
  }

  const hasBio = bio && bio.id;

  return (
    <div className="p-6 w-full space-y-6">

      {/* ── Scanner Hero — always visible except when editing ── */}
      {!editing && (
        <div className="rounded-2xl overflow-hidden" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
          {/* Dark banner */}
          <div className="px-8 py-6 flex items-center justify-between gap-6"
            style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)" }}>
            <div className="flex items-center gap-5">
              <span className="text-4xl select-none">🌐</span>
              <div>
                <h2 className="text-xl font-bold text-white">Company Bio Scanner</h2>
                <p className="text-sm mt-1 leading-relaxed" style={{ color: "#94A3B8" }}>
                  Scan a client's website in real-time to generate a comprehensive AI company breakdown and contact strategy.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                <span className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "#22C55E" }} />
                <span className="text-sm font-medium text-white">Ready</span>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#94A3B8" }}>
                AI Web Indexer
              </span>
            </div>
          </div>

          {/* Scan controls */}
          <div className="p-6" style={{ backgroundColor: C.card, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, borderRadius: "0 0 16px 16px" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.textMuted }}>Target Website</p>

            {/* Language pills */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: C.textDim }}>
                Scan Language
              </span>
              <div className="flex gap-1.5">
                {LANGUAGES.map(l => (
                  <button key={l.code}
                    onClick={() => setScanLang(l.code)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
                    style={scanLang === l.code
                      ? { backgroundColor: gold, color: "#04070d" }
                      : { backgroundColor: "#F3F4F6", color: C.textMuted, border: `1px solid ${C.border}` }
                    }>
                    <span>{l.flag}</span> {l.code}
                  </button>
                ))}
              </div>
            </div>

            {/* URL + button */}
            <div className="flex gap-3">
              <input
                className="flex-1 rounded-lg border px-4 py-3 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={scrapeUrl}
                onChange={e => setScrapeUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleScrape()}
                placeholder="e.g. https://www.acme-corp.com"
                disabled={scraping}
              />
              <button
                onClick={handleScrape}
                disabled={scraping || !scrapeUrl.trim()}
                className="flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-40 shrink-0 hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #0F172A, #1E293B)", color: "#fff" }}>
                {scraping ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />}
                {scraping ? "Scanning..." : "Scan Web"}
              </button>
            </div>
            {scrapeError && (
              <p className="text-xs mt-2" style={{ color: C.red }}>
                <AlertCircle size={11} className="inline mr-1" />{scrapeError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Edit header ── */}
      {editing && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>
            {hasBio ? "Editing" : "New Company"}
          </p>
          <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
            <Building2 size={22} style={{ color: gold }} />
            Company Bio
          </h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>
            Only the name is required — everything else can be added later.
          </p>
          <div className="h-px mt-5" style={{ background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />
        </div>
      )}

      {/* ── Content ── */}
      {hasBio && !editing ? (
        <>
          <div className="flex items-center gap-2 text-xs -mt-2" style={{ color: C.textMuted }}>
            <span>Company Bio</span>
            <span>/</span>
            <span style={{ color: C.textBody }}>{bio.company_name}</span>
          </div>
          <BioView bio={bio} onEdit={() => setEditing(true)} />
        </>
      ) : !hasBio && !editing ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="rounded-2xl border p-8 max-w-md w-full text-center relative overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="absolute inset-x-0 top-0 h-1"
              style={{ background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white), ${gold})` }} />
            <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
              style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 13%, transparent), color-mix(in srgb, ${gold} 3%, transparent))`, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
              <Building2 size={24} style={{ color: gold }} />
            </div>
            <h2 className="text-base font-bold mb-1.5" style={{ color: C.textPrimary }}>No company profile yet</h2>
            <p className="text-xs mb-5" style={{ color: C.textMuted }}>
              Scan a website above or create your profile manually. This info personalizes your AI outreach.
            </p>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-lg hover:opacity-95"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#04070d" }}>
              <Plus size={15} /> Create Manually
            </button>
            <div className="mt-6 pt-5 border-t grid grid-cols-3 gap-3" style={{ borderColor: C.border }}>
              {[
                { icon: "1", label: "Enter your company info" },
                { icon: "2", label: "AI personalizes messages" },
                { icon: "3", label: "Better outreach, more replies" },
              ].map(step => (
                <div key={step.icon} className="text-center">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-1 text-xs font-bold"
                    style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
                    {step.icon}
                  </div>
                  <p className="text-xs" style={{ color: C.textMuted }}>{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <BioForm
          bio={prefilled ?? bio ?? empty}
          isNew={!hasBio}
          onSave={(saved) => { setBio(saved); setEditing(false); setPrefilled(null); }}
          onCancel={() => { setEditing(false); setPrefilled(null); }}
          onDelete={() => { setBio(null); setEditing(false); setPrefilled(null); }}
        />
      )}
    </div>
  );
}
