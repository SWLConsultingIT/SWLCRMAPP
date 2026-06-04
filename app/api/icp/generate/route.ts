// POST /api/icp/generate — draft an ICP profile with Claude from a short brief.
//
// The user gives a free-text prompt (what they're hunting for) plus optional
// hints (geography, language, a company URL). We ground the model with the
// tenant's Company Bio so the pain points / solutions are written in *their*
// voice and about *their* offering — not generic filler. Returns a structured
// draft the client drops straight into the ICP form; nothing is persisted here.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const maxDuration = 60;

const COMPANY_SIZE_BUCKETS = ["1-10", "11-50", "51-200", "201-500", "500+"];

type Draft = {
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  company_size_buckets: string[];
  geography: string[];
  pain_points: string;
  solutions_offered: string;
  notes: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  const geography = String(body?.geography ?? "").trim();
  const language = String(body?.language ?? "").trim();
  const url = String(body?.url ?? "").trim();

  if (!prompt && !url) {
    return NextResponse.json({ error: "Describe the segment or provide a company URL." }, { status: 400 });
  }

  const svc = getSupabaseService();

  // Ground in the tenant's Company Bio so the offering/voice is theirs.
  let bioContext = "";
  if (scope.companyBioId) {
    const { data: bio } = await svc
      .from("company_bios")
      .select("company_name, industry, description, value_proposition, main_services, target_market, differentiators, website, tagline")
      .eq("id", scope.companyBioId)
      .single();
    if (bio) {
      const arr = (v: unknown) => Array.isArray(v) ? v.join(", ") : (v ?? "");
      bioContext = [
        bio.company_name && `Company: ${bio.company_name}`,
        bio.tagline && `Tagline: ${bio.tagline}`,
        bio.industry && `Industry: ${bio.industry}`,
        bio.description && `What they do: ${bio.description}`,
        bio.value_proposition && `Value proposition: ${bio.value_proposition}`,
        bio.main_services && `Main services: ${arr(bio.main_services)}`,
        bio.target_market && `Target market: ${bio.target_market}`,
        bio.differentiators && `Differentiators: ${bio.differentiators}`,
      ].filter(Boolean).join("\n");
    }
  }

  // Optional: pull a bit of text from a company URL to sharpen the draft.
  let urlContext = "";
  if (url && /^https?:\/\//i.test(url)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "GrowthAI-ICP/1.0" } });
      clearTimeout(t);
      if (res.ok) {
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        urlContext = text.slice(0, 4000);
      }
    } catch {
      // URL fetch is best-effort; ignore failures (timeout, blocked, etc.)
    }
  }

  const draft = await generate({ prompt, geography, language, bioContext, urlContext, apiKey });
  if (!draft) return NextResponse.json({ error: "AI generation failed. Try again." }, { status: 502 });

  return NextResponse.json({ ok: true, draft });
}

async function generate(opts: {
  prompt: string; geography: string; language: string;
  bioContext: string; urlContext: string; apiKey: string;
}): Promise<Draft | null> {
  const { prompt, geography, language, bioContext, urlContext, apiKey } = opts;

  const sys = `You are a B2B go-to-market strategist. You draft Ideal Customer Profiles (ICPs) for an outbound sales engine. You ALWAYS respond with a single valid JSON object and nothing else — no markdown, no code fences, no prose.`;

  const user = `Draft an ICP from the brief below.

${bioContext ? `OUR COMPANY (write pain_points and solutions_offered about THIS offering, in this voice):\n${bioContext}\n` : ""}
${urlContext ? `REFERENCE WEBSITE CONTENT (a company URL the user provided — use it to infer industry, size and what they do):\n${urlContext}\n` : ""}
USER BRIEF: ${prompt || "(none — infer everything from the website content above)"}
${geography ? `GEOGRAPHY HINT: ${geography}` : ""}
${language ? `OUTPUT LANGUAGE: write pain_points, solutions_offered and notes in ${language}.` : ""}

Return EXACTLY this JSON shape:
{
  "profile_name": "short label, e.g. 'Construction SMEs — Argentina'",
  "target_industries": ["3-6 specific industries"],
  "target_roles": ["3-7 decision-maker job titles"],
  "company_size_buckets": ["subset of these exact values only: ${COMPANY_SIZE_BUCKETS.join(", ")}"],
  "geography": ["countries or regions to target"],
  "pain_points": "2-4 sentences: the concrete problems this segment has that OUR company solves. Specific, not generic.",
  "solutions_offered": "2-4 sentences: which of OUR services/products fit this segment and why.",
  "notes": "1-3 sentences: qualifiers or signals that make a lead ideal (e.g. tech stack, recent funding, hiring signals)."
}

Rules:
- company_size_buckets MUST only contain values from: ${COMPANY_SIZE_BUCKETS.join(", ")}. Pick the bands that fit; use [] if truly unknown.
- Arrays must be non-empty where you can reasonably infer values.
- Output ONLY the JSON object.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: sys,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content[0]?.type === "text" ? res.content[0].text : "";
    return normalize(raw);
  } catch {
    return null;
  }
}

// Parse the model output defensively and clamp it to the form's expectations.
function normalize(raw: string): Draft | null {
  if (!raw) return null;
  let txt = raw.trim();
  // Strip accidental code fences.
  txt = txt.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  // Grab the outermost JSON object if the model wrapped it in prose.
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(txt.slice(start, end + 1));
  } catch {
    return null;
  }
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  return {
    profile_name: str(obj.profile_name),
    target_industries: arr(obj.target_industries),
    target_roles: arr(obj.target_roles),
    company_size_buckets: arr(obj.company_size_buckets).filter(b => COMPANY_SIZE_BUCKETS.includes(b)),
    geography: arr(obj.geography),
    pain_points: str(obj.pain_points),
    solutions_offered: str(obj.solutions_offered),
    notes: str(obj.notes),
  };
}
