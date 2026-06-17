import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const LANG_MAP: Record<string, string> = {
  EN: "English", IT: "Italian", ES: "Spanish", FR: "French", DE: "German",
};

// Generic patterns that indicate a share/widget/intent URL — not a real account.
// These appear in tweet/share buttons, OAuth dialogs, embedded plugins, etc.
const SHARE_PATH_BLOCKLIST = [
  "/intent/", "/share", "/sharer", "/sharing/", "/dialog/", "/plugins/",
  "/embed/", "/oauth", "/login", "/signup", "/help", "/about", "/privacy",
  "/terms", "/policies", "/i/flow", "/home", "/explore", "/search",
];

// Reserved handles that aren't real company accounts (used by share widgets,
// generic landing links, or platform-internal pages).
const RESERVED_HANDLES = new Set([
  "share", "sharer", "intent", "home", "explore", "login", "signup", "help",
  "about", "privacy", "terms", "policies", "settings", "profile", "tv",
  "watch", "channel", "user", "c", "embed", "p", "reel", "stories",
]);

function isShareUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SHARE_PATH_BLOCKLIST.some(p => lower.includes(p));
}

function cleanUrl(url: string): string {
  // Drop query string + fragment, then trim trailing slash.
  return url.split("?")[0].split("#")[0].replace(/\/+$/, "");
}

function firstHandleSegment(pathname: string): string | null {
  const seg = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  return seg ? seg.toLowerCase() : null;
}

function extractAllHrefs(html: string, hostPattern: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(`href=["'](https?:\\/\\/[^"'\\s]*${hostPattern.source}[^"'\\s]*)["']`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function pickFirst<T>(arr: T[], predicate: (v: T) => boolean): T | null {
  for (const v of arr) if (predicate(v)) return v;
  return null;
}

// Social handles baked into popular WordPress themes / page-builders' DEMO
// content — these are the THEME VENDOR's own accounts, not the client's, but
// they sit in the markup so the crawler kept grabbing them. Real example:
// grupoieb.com.ar runs a QodeInteractive theme whose footer links to
// instagram.com/qodeinteractive, facebook.com/QodeInteractive, etc. Reject them.
const THEME_VENDOR_HANDLES = new Set([
  "qodeinteractive", "qode", "selectthemes", "select-themes", "mikadothemes",
  "mikado-themes", "elementor", "wpbakery", "envato", "themeforest", "themefusion",
  "wordpressdotcom", "wix", "squarespace", "godaddy",
]);

// Main label of the site's own domain (e.g. "grupoieb.com.ar" → "grupoieb"),
// used to PREFER a social link whose handle relates to the company over any
// leftover vendor/partner link.
function domainTokensOf(pageUrl: string): string[] {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    return [host.split(".")[0]].filter(t => t.length >= 4);
  } catch { return []; }
}

// Pick the best social link for a network: drop share/widget + theme-vendor
// accounts, then PREFER one whose handle relates to the company's own domain
// (so the client's real account wins over a vendor's), else the first valid.
function bestSocial(
  candidates: string[],
  validate: (u: string) => boolean,
  getHandle: (u: string) => string | null,
  domainTokens: string[],
): string | null {
  const valid = candidates.filter((u) => {
    if (isShareUrl(u)) return false;
    const h = getHandle(u);
    if (h && THEME_VENDOR_HANDLES.has(h.toLowerCase())) return false;
    return validate(u);
  });
  if (valid.length === 0) return null;
  const related = valid.find((u) => {
    const h = (getHandle(u) ?? "").toLowerCase();
    return domainTokens.some((t) => h.includes(t));
  });
  return related ?? valid[0];
}

function extractSocialLinks(html: string, pageUrl: string): {
  linkedin_url: string;
  instagram_url: string;
  twitter_url: string;
  facebook_url: string;
  youtube_url: string;
  tiktok_url: string;
} {
  const tokens = domainTokensOf(pageUrl);
  const pathOf = (u: string): string => { try { return new URL(u).pathname; } catch { return ""; } };

  // LinkedIn — must be /company/<slug> or /in/<slug>. Reject share/widget URLs.
  const linkedin = bestSocial(
    extractAllHrefs(html, /linkedin\.com/),
    (u) => /^\/(company|school|in)\/[^/]+/.test(pathOf(u).toLowerCase()),
    (u) => pathOf(u).split("/")[2] ?? null, // slug after /company|/in
    tokens,
  );

  // Instagram — must have a non-reserved handle as the first path segment.
  const instagram = bestSocial(
    extractAllHrefs(html, /instagram\.com/),
    (u) => { const h = firstHandleSegment(pathOf(u)); return !!h && !RESERVED_HANDLES.has(h) && h !== "accounts"; },
    (u) => firstHandleSegment(pathOf(u)),
    tokens,
  );

  // Twitter / X — require a real handle (not /intent/tweet, not /share, not just root).
  const twitter = bestSocial(
    extractAllHrefs(html, /(?:twitter|x)\.com/),
    (u) => { const h = firstHandleSegment(pathOf(u)); return !!h && !RESERVED_HANDLES.has(h) && h !== "i"; },
    (u) => firstHandleSegment(pathOf(u)),
    tokens,
  );

  // Facebook — reject sharer.php, dialog, plugins, tr (pixel), watch, etc.
  const facebook = bestSocial(
    extractAllHrefs(html, /facebook\.com/),
    (u) => {
      const p = pathOf(u).toLowerCase();
      if (/^\/(sharer|dialog|plugins|tr|watch|events|groups|marketplace)/.test(p)) return false;
      if (p === "" || p === "/") return false;
      return /^\/[a-z0-9._-]+/i.test(p);
    },
    (u) => firstHandleSegment(pathOf(u)),
    tokens,
  );

  // YouTube — only @handle, /channel/<id>, /c/<name>, or /user/<name>.
  const youtube = bestSocial(
    extractAllHrefs(html, /youtube\.com/),
    (u) => /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/i.test(pathOf(u)),
    (u) => pathOf(u).replace(/^\/(channel|c|user)\//i, "").replace(/^\/@/, "").split("/")[0] || null,
    tokens,
  );

  // TikTok — must be /@handle (real account), not /share/, /tag/, etc.
  const tiktok = bestSocial(
    extractAllHrefs(html, /tiktok\.com/),
    (u) => /^\/@[^/]+/.test(pathOf(u)),
    (u) => pathOf(u).replace(/^\/@/, "").split("/")[0] || null,
    tokens,
  );

  return {
    linkedin_url: linkedin ? cleanUrl(linkedin) : "",
    instagram_url: instagram ? cleanUrl(instagram) : "",
    twitter_url: twitter ? cleanUrl(twitter) : "",
    facebook_url: facebook ? cleanUrl(facebook) : "",
    youtube_url: youtube ? cleanUrl(youtube) : "",
    tiktok_url: tiktok ? cleanUrl(tiktok) : "",
  };
}

export async function POST(req: NextRequest) {
  const { url, lang = "EN" } = await req.json();
  const language = LANG_MAP[lang] ?? "English";

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  // Reject search-engine result pages up-front. People paste a Google/Bing
  // search URL (the address bar after searching the company) instead of the
  // company's own site; those pages are bot-blocked / junk, so the AI gets no
  // usable content and fails with the cryptic "no JSON object in response".
  // Give an actionable message instead (Fran 2026-06-17, Grupo IEB).
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "search.brave.com", "search.yahoo.com", "yandex."];
    const isSearch = SEARCH_HOSTS.some(h => host.startsWith(h) || host.includes(h)) && (u.pathname.includes("/search") || u.searchParams.has("q"));
    if (isSearch) {
      return NextResponse.json(
        { error: "That looks like a search-results page. Paste the company's own website (e.g. https://www.company.com), not a Google/Bing search." },
        { status: 422 },
      );
    }
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid website URL. Paste the company's site, e.g. https://www.company.com" }, { status: 422 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    // 1. Fetch the homepage + opportunistically /about and /services pages
    //    so the AI sees more of the company's actual messaging. Many homepages
    //    only have a hero + features grid; the meatier copy lives on About/
    //    Services subpages. We do these in parallel with a short timeout each
    //    so a missing/slow page doesn't block the main scrape.
    const fetchPage = async (target: string): Promise<string> => {
      try {
        const r = await fetch(target, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SWLBot/1.0)" },
          signal: AbortSignal.timeout(7000),
        });
        if (!r.ok) return "";
        return await r.text();
      } catch { return ""; }
    };

    const homeRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SWLBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!homeRes.ok) {
      return NextResponse.json({ error: `Could not fetch website (${homeRes.status})` }, { status: 422 });
    }
    const html = await homeRes.text();

    // Build base origin for subpage fetches so we don't double-count if the
    // user pasted a URL with path/query.
    let origin = url;
    let pastedHadPath = false;
    try {
      const u = new URL(url);
      origin = u.origin;
      pastedHadPath = u.pathname.length > 1; // anything beyond "/"
    } catch { /* fall through with raw url */ }

    // Pull subpages in parallel. Spanish/Italian/French sites use different
    // names for the same kind of page — try the common ones across the langs
    // we support. If the user pasted a deep URL (e.g. /project-management),
    // also fetch the root since the homepage usually has the broader pitch.
    const subpageTargets = [
      `${origin}/about`,
      `${origin}/services`,
      `${origin}/nosotros`,
      `${origin}/servicios`,
      `${origin}/chi-siamo`,
      `${origin}/servizi`,
      `${origin}/a-propos`,
      `${origin}/ueber-uns`,
    ];
    if (pastedHadPath) subpageTargets.push(origin);

    const subPages = await Promise.all(subpageTargets.map(fetchPage));

    const stripHtml = (raw: string): string => raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const homeText = stripHtml(html);
    const subText = subPages.map(stripHtml).filter(t => t.length > 100).join("\n\n");

    // Larger budget (12k chars) — Claude Haiku handles it fine and the extra
    // context helps with main_services + value_proposition quality. The AI
    // already had 8k for homepage alone; subpages add ~4k more on average.
    const cleaned = `${homeText}\n\n${subText}`.slice(0, 12000);

    // Extract meta tags separately for better context
    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
    const ogLocale = html.match(/<meta[^>]*property=["']og:locale["'][^>]*content=["']([^"']*)["']/i);
    const htmlLang = html.match(/<html[^>]*lang=["']([^"']+)["']/i);

    // Extract social links from HTML — collect all candidates, then filter out
    // share/intent/sharer URLs (they're widgets pointing to the social network,
    // not the company's own account) and validate per-platform path shape.
    const socialLinks = extractSocialLinks(html, url);

    // Detect site language so we can pass it as context to the AI (helps it
    // understand source copy), but ALWAYS respect the language the user
    // picked in the UI for the output. The user clicks EN/IT/ES/FR/DE
    // explicitly because they want the bio in that language; auto-overriding
    // based on the site's <html lang> defeats the toggle.
    const htmlLangCode = (htmlLang?.[1] ?? "").trim().toLowerCase().split("-")[0];
    const ogLocaleCode = (ogLocale?.[1] ?? "").trim().toLowerCase().split("_")[0];
    const detectedLang = htmlLangCode || ogLocaleCode || "";
    const langForExtraction = language;

    // 2. Call Claude Haiku to extract structured info. Richer schema (employees
    //    range, founded year, target_seniority hints) lets the demo data
    //    generator make more realistic ICPs + leads downstream. Migrated from
    //    OpenAI gpt-4o-mini → Claude Haiku 2026-06-08 (the shared OpenAI key
    //    hit insufficient_quota and broke every scan).
    const sysPrompt = `You extract company information from website content (homepage + /about + /services subpages). Return a JSON object with these fields. Leave empty string "" if not clearly stated:

- company_name: string
- tagline: string (short slogan, max 80 chars)
- industry: string — be specific (e.g. "Recruitment Finance Brokerage", "B2B SaaS — Sales Enablement", "Hospitality / Boutique Hotels"). Avoid generic "Consulting" alone.
- description: string (2-4 sentences about what the company does, in their own words where possible)
- value_proposition: string (one sentence: what problem they solve, for whom — concrete, not buzzwordy)
- main_services: string[] (max 10 services/products, each 2-6 words)
- differentiators: string (what makes them different — bullet points separated by newlines, max 5 bullets)
- target_market: string (the ideal customer profile in 1-2 sentences — industry + size + role of buyer)
- location: string (city, country)
- tone_of_voice: string — pick from: "professional", "consultative", "technical", "playful", "premium / luxury", "scrappy / bootstrapped", "academic", or describe in 2-3 words
- founded_year: integer (4-digit year if mentioned, else null)
- team_size: string — pick from: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+", or "" if not stated
- key_clients: string[] (named clients/case studies if listed, max 6, else [])

CRITICAL:
- Be specific over generic. "Helping businesses grow" is useless — say HOW (e.g. "invoice finance for recruitment agencies funding weekly payroll").
- Quote them when possible. Don't invent.
- Output ALL text fields in ${langForExtraction}. If the source website is in a different language than ${langForExtraction}, TRANSLATE the content — do not copy phrases in the source language. Proper nouns (company names, product names, places) stay as-is.
- Return ONLY the raw JSON object — no markdown code fences, no prose before or after.`;

    const userPrompt = `Website URL: ${url}
Title: ${titleMatch?.[1] ?? ogTitle?.[1] ?? ""}
Meta description: ${metaMatch?.[1] ?? ogDesc?.[1] ?? ""}
Detected language: ${detectedLang || "(unknown)"}

Combined page content (homepage + /about + /services if available):
${cleaned}`;

    let parsed: Record<string, unknown>;
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const aiRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: sysPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const raw = aiRes.content[0]?.type === "text" ? aiRes.content[0].text : "";
      // Anthropic has no json_object mode — strip any fences and grab the
      // outermost {...} before parsing.
      const txt = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = txt.indexOf("{");
      const end = txt.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("no JSON object in response");
      parsed = JSON.parse(txt.slice(start, end + 1));
    } catch (e: unknown) {
      // The most common cause is thin/blocked page content (JS-only site, login
      // wall, or a non-company URL) so the model can't extract a profile. Surface
      // an actionable hint instead of the raw "no JSON object in response".
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("no JSON object")
        ? "Couldn't read enough company info from that page. Make sure it's the company's main website (homepage), not a search result, login page or a JavaScript-only app."
        : `Couldn't analyze the page: ${msg}`;
      return NextResponse.json({ error: friendly }, { status: 502 });
    }

    // Whitelist only the columns that exist on company_bios. The AI sometimes
    // hallucinates extra fields (employees_range, target_buyer_seniority, etc.)
    // and if those leak into the form, the save fails with a Postgres
    // "column does not exist" error. Keep this list aligned with the schema.
    const ALLOWED_KEYS = [
      "company_name", "tagline", "industry", "description", "value_proposition",
      "main_services", "differentiators", "target_market", "location",
      "tone_of_voice", "founded_year", "team_size", "key_clients",
    ] as const;

    const cleanBio: Record<string, unknown> = {};
    for (const k of ALLOWED_KEYS) {
      if (parsed[k] !== undefined && parsed[k] !== null) cleanBio[k] = parsed[k];
    }

    // Coerce founded_year to a number (DB column is integer). The AI sometimes
    // returns a 4-digit string instead of a number despite the schema.
    if (typeof cleanBio.founded_year === "string") {
      const n = parseInt(cleanBio.founded_year, 10);
      cleanBio.founded_year = Number.isFinite(n) ? n : null;
    }

    // Merge whitelisted AI fields with scraped social links + the URL itself.
    return NextResponse.json({
      ...cleanBio,
      website: url,
      // Only include social URLs that the regex actually found.
      ...(socialLinks.linkedin_url ? { linkedin_url: socialLinks.linkedin_url } : {}),
      ...(socialLinks.instagram_url ? { instagram_url: socialLinks.instagram_url } : {}),
      ...(socialLinks.twitter_url ? { twitter_url: socialLinks.twitter_url } : {}),
      ...(socialLinks.facebook_url ? { facebook_url: socialLinks.facebook_url } : {}),
      ...(socialLinks.youtube_url ? { youtube_url: socialLinks.youtube_url } : {}),
      ...(socialLinks.tiktok_url ? { tiktok_url: socialLinks.tiktok_url } : {}),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to scrape website" },
      { status: 500 }
    );
  }
}
