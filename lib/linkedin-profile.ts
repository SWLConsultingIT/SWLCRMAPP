// Fetches a lead's LinkedIn profile via Unipile and renders it for the
// Pre-Call Brief prompt. The brief used to be generic because most leads
// carry only a LinkedIn URL/internal-id — the rich profile (headline, About,
// experience, skills) lives on LinkedIn, not in our DB. Pulling it on demand
// (when a seller opens the lead) gives the AI real material to work with.
//
// LinkedIn-safety note: profile views happen one-at-a-time at human pace as
// sellers open leads — NOT in bulk. Never loop this over many leads from a
// single account; a profile-view spike can get the seller's account
// restricted (see the "extreme caution with LinkedIn automation" rule).

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

export type LinkedInProfile = {
  headline: string | null;
  summary: string | null;
  location: string | null;
  currentRole: string | null;
  experience: Array<{ position?: string; company?: string; description?: string }>;
  topSkills: string[];
  education: Array<{ degree?: string; school?: string }>;
};

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() && v.trim() !== "--" ? v.trim() : null;
}

// Prefer the stable provider id; otherwise pull the public slug from the URL
// (Unipile accepts both as the {identifier} path segment).
export function linkedinIdentifier(internalId?: string | null, url?: string | null): string | null {
  if (internalId && internalId.trim()) return internalId.trim();
  if (url) {
    const m = url.match(/\/in\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export async function fetchLinkedInProfile(identifier: string, accountId: string): Promise<LinkedInProfile | null> {
  if (!UNIPILE_KEY || !identifier || !accountId) return null;
  try {
    const url = `${UNIPILE_BASE}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*`;
    const res = await fetch(url, { headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" } });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || typeof d !== "object") return null;
    const we: any[] = Array.isArray(d.work_experience) ? d.work_experience : [];
    const skills: any[] = Array.isArray(d.skills) ? d.skills : [];
    const edu: any[] = Array.isArray(d.education) ? d.education : [];
    const cur = we[0];
    return {
      headline: clean(d.headline),
      summary: clean(d.summary),
      location: clean(d.location),
      currentRole: cur ? [clean(cur.position), clean(cur.company)].filter(Boolean).join(" @ ") || null : null,
      experience: we.slice(0, 4).map((e) => ({
        position: clean(e?.position) ?? undefined,
        company: clean(e?.company) ?? undefined,
        description: typeof e?.description === "string" ? e.description.trim().slice(0, 300) : undefined,
      })),
      topSkills: skills.map((s) => clean(s?.name)).filter((x): x is string => !!x).slice(0, 10),
      education: edu.slice(0, 3).map((e) => ({ degree: clean(e?.degree) ?? undefined, school: clean(e?.school) ?? undefined })),
    };
  } catch {
    return null;
  }
}

// Returns true when the profile actually carries usable signal (some leads
// resolve but their profile is empty — headline "--", no summary/experience).
export function profileHasSignal(p: LinkedInProfile | null): p is LinkedInProfile {
  return !!p && !!(p.headline || p.summary || p.currentRole || p.experience.length || p.topSkills.length);
}

// Renders the profile into a prompt block the talking-points generator reads.
export function renderLinkedInBlock(p: LinkedInProfile): string {
  const lines: string[] = ["LINKEDIN PROFILE (the lead's own words — anchor the brief on this)"];
  if (p.headline) lines.push(`- Headline: ${p.headline}`);
  if (p.location) lines.push(`- Location: ${p.location}`);
  if (p.currentRole) lines.push(`- Current role: ${p.currentRole}`);
  if (p.summary) lines.push(`- About: ${p.summary.slice(0, 700)}`);
  if (p.experience.length) {
    lines.push("- Experience:");
    for (const e of p.experience) {
      const head = [e.position, e.company].filter(Boolean).join(" @ ");
      lines.push(`  • ${head}${e.description ? ` — ${e.description.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
    }
  }
  if (p.topSkills.length) lines.push(`- Skills: ${p.topSkills.join(", ")}`);
  if (p.education.length) {
    lines.push(`- Education: ${p.education.map((e) => [e.degree, e.school].filter(Boolean).join(", ")).filter(Boolean).join(" | ")}`);
  }
  return lines.join("\n");
}
