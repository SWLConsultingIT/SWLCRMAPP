// Fetches a lead's LinkedIn profile via Unipile. Two consumers:
//  - the Pre-Call Brief generator (trimmed → prompt block)
//  - the LinkedIn Enrichment panel in the lead detail (full → rendered for the
//    seller: About, full work history with dates, education, skills, etc.)
//
// LinkedIn-safety note: profile views happen one-at-a-time at human pace —
// when a seller opens a lead or clicks "LinkedIn Enrichment". NEVER loop this
// over many leads from a single account; a profile-view spike can get the
// seller's account restricted ("extreme caution with LinkedIn automation").

const UNIPILE_BASE = process.env.UNIPILE_DSN
  ? `https://${process.env.UNIPILE_DSN}`
  : "https://api21.unipile.com:15107";
const UNIPILE_KEY = process.env.UNIPILE_API_KEY ?? "";

export type LinkedInExperience = {
  position: string | null;
  company: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  description: string | null;
  companyPictureUrl: string | null;
};
export type LinkedInEducation = { degree: string | null; school: string | null; start: string | null; end: string | null };

// Full profile — everything the enrichment panel renders.
export type LinkedInFullProfile = {
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  profilePictureUrl: string | null;
  connectionsCount: number | null;
  followerCount: number | null;
  isPremium: boolean;
  networkDistance: string | null;
  experience: LinkedInExperience[];
  education: LinkedInEducation[];
  skills: Array<{ name: string; endorsements: number }>;
  languages: string[];
  certifications: string[];
};

// Trimmed shape the brief prompt reads.
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

async function unipileProfileRaw(identifier: string, accountId: string): Promise<any | null> {
  if (!UNIPILE_KEY || !identifier || !accountId) return null;
  try {
    const url = `${UNIPILE_BASE}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*`;
    const res = await fetch(url, { headers: { "X-API-KEY": UNIPILE_KEY, accept: "application/json" } });
    if (!res.ok) return null;
    const d = await res.json();
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

export async function fetchLinkedInProfileFull(identifier: string, accountId: string): Promise<LinkedInFullProfile | null> {
  const d = await unipileProfileRaw(identifier, accountId);
  if (!d) return null;
  const we: any[] = Array.isArray(d.work_experience) ? d.work_experience : [];
  const skills: any[] = Array.isArray(d.skills) ? d.skills : [];
  const edu: any[] = Array.isArray(d.education) ? d.education : [];
  const langs: any[] = Array.isArray(d.languages) ? d.languages : [];
  const certs: any[] = Array.isArray(d.certifications) ? d.certifications : [];
  const pub = clean(d.public_identifier);
  return {
    firstName: clean(d.first_name),
    lastName: clean(d.last_name),
    headline: clean(d.headline),
    summary: clean(d.summary),
    location: clean(d.location),
    publicIdentifier: pub,
    profileUrl: pub ? `https://www.linkedin.com/in/${pub}` : null,
    profilePictureUrl: clean(d.profile_picture_url) ?? clean(d.profile_picture_url_large),
    connectionsCount: typeof d.connections_count === "number" ? d.connections_count : null,
    followerCount: typeof d.follower_count === "number" ? d.follower_count : null,
    isPremium: !!d.is_premium,
    networkDistance: clean(d.network_distance),
    experience: we.map((e) => ({
      position: clean(e?.position),
      company: clean(e?.company),
      location: clean(e?.location),
      start: clean(e?.start),
      end: clean(e?.end),
      description: typeof e?.description === "string" ? e.description.trim() : null,
      companyPictureUrl: clean(e?.company_picture_url),
    })),
    education: edu.map((e) => ({ degree: clean(e?.degree), school: clean(e?.school), start: clean(e?.start), end: clean(e?.end) })),
    skills: skills.map((s) => ({ name: clean(s?.name) ?? "", endorsements: typeof s?.endorsement_count === "number" ? s.endorsement_count : 0 })).filter((s) => s.name),
    languages: langs.map((l) => clean(typeof l === "string" ? l : l?.name)).filter((x): x is string => !!x),
    certifications: certs.map((c) => clean(typeof c === "string" ? c : c?.name)).filter((x): x is string => !!x),
  };
}

// Trims a full profile to the brief shape.
export function toBriefProfile(p: LinkedInFullProfile): LinkedInProfile {
  const cur = p.experience[0];
  return {
    headline: p.headline,
    summary: p.summary,
    location: p.location,
    currentRole: cur ? [cur.position, cur.company].filter(Boolean).join(" @ ") || null : null,
    experience: p.experience.slice(0, 4).map((e) => ({
      position: e.position ?? undefined,
      company: e.company ?? undefined,
      description: e.description ? e.description.slice(0, 300) : undefined,
    })),
    topSkills: p.skills.slice(0, 10).map((s) => s.name),
    education: p.education.slice(0, 3).map((e) => ({ degree: e.degree ?? undefined, school: e.school ?? undefined })),
  };
}

export async function fetchLinkedInProfile(identifier: string, accountId: string): Promise<LinkedInProfile | null> {
  const full = await fetchLinkedInProfileFull(identifier, accountId);
  return full ? toBriefProfile(full) : null;
}

// True when the profile carries usable signal (some resolve but are empty).
export function profileHasSignal(p: LinkedInProfile | null): p is LinkedInProfile {
  return !!p && !!(p.headline || p.summary || p.currentRole || p.experience.length || p.topSkills.length);
}

// True when a FULL profile carries usable signal.
export function fullProfileHasSignal(p: LinkedInFullProfile | null): p is LinkedInFullProfile {
  return !!p && !!(p.headline || p.summary || p.experience.length || p.skills.length || p.education.length);
}

// Renders the FULL profile into a rich prompt block for the brief generator.
// Unlike renderLinkedInBlock (trimmed), this keeps the signals that make a
// brief feel researched: experience WITH dates (so the model can infer tenure
// and spot a recent job change — the strongest opener hook), education,
// certifications, languages, network size and seniority.
export function renderFullLinkedInBlock(p: LinkedInFullProfile): string {
  const lines: string[] = ["LINKEDIN PROFILE — the lead's own words + work history. Anchor the brief on this and cite specifics; never invent facts not present here."];
  if (p.headline) lines.push(`- Headline: ${p.headline}`);
  if (p.location) lines.push(`- Location: ${p.location}`);
  const net = [
    p.networkDistance ? p.networkDistance : null,
    typeof p.connectionsCount === "number" ? `${p.connectionsCount} connections` : null,
    typeof p.followerCount === "number" && p.followerCount > 0 ? `${p.followerCount} followers` : null,
    p.isPremium ? "Premium" : null,
  ].filter(Boolean).join(" · ");
  if (net) lines.push(`- Network: ${net}`);
  if (p.summary) lines.push(`- About: ${p.summary.replace(/\s+/g, " ").slice(0, 900)}`);
  if (p.experience.length) {
    lines.push("- Experience (most recent first — use the dates to infer tenure in current role and any recent move):");
    for (const e of p.experience.slice(0, 5)) {
      const head = [e.position, e.company].filter(Boolean).join(" @ ");
      const span = [e.start, e.end].filter(Boolean).join(" – ");
      const desc = e.description ? ` — ${e.description.replace(/\s+/g, " ").slice(0, 180)}` : "";
      lines.push(`  • ${head}${span ? ` (${span})` : ""}${desc}`);
    }
  }
  if (p.education.length) {
    lines.push(`- Education: ${p.education.slice(0, 3).map((e) => [e.degree, e.school].filter(Boolean).join(", ")).filter(Boolean).join(" | ")}`);
  }
  if (p.certifications.length) lines.push(`- Certifications: ${p.certifications.slice(0, 6).join(", ")}`);
  if (p.languages.length) lines.push(`- Languages: ${p.languages.join(", ")}`);
  if (p.skills.length) lines.push(`- Top skills: ${p.skills.slice(0, 12).map((s) => s.name).join(", ")}`);
  return lines.join("\n");
}

// Renders the trimmed profile into a prompt block for the brief generator.
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
