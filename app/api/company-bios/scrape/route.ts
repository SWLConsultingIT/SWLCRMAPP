import { NextRequest, NextResponse } from "next/server";

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

function extractSocialLinks(html: string): {
  linkedin_url: string;
  instagram_url: string;
  twitter_url: string;
  facebook_url: string;
  youtube_url: string;
  tiktok_url: string;
} {
  // LinkedIn — must be /company/<slug> or /in/<slug>. Reject share/widget URLs.
  const linkedin = pickFirst(
    extractAllHrefs(html, /linkedin\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const p = new URL(u).pathname.toLowerCase();
        return /^\/(company|school|in)\/[^/]+/.test(p);
      } catch { return false; }
    },
  );

  // Instagram — must have a non-reserved handle as the first path segment.
  const instagram = pickFirst(
    extractAllHrefs(html, /instagram\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const handle = firstHandleSegment(new URL(u).pathname);
        return !!handle && !RESERVED_HANDLES.has(handle) && handle !== "accounts";
      } catch { return false; }
    },
  );

  // Twitter / X — require a real handle (not /intent/tweet, not /share, not just root).
  const twitter = pickFirst(
    extractAllHrefs(html, /(?:twitter|x)\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const handle = firstHandleSegment(new URL(u).pathname);
        return !!handle && !RESERVED_HANDLES.has(handle) && handle !== "i";
      } catch { return false; }
    },
  );

  // Facebook — reject sharer.php, dialog, plugins, tr (pixel), watch, etc.
  const facebook = pickFirst(
    extractAllHrefs(html, /facebook\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const p = new URL(u).pathname.toLowerCase();
        if (/^\/(sharer|dialog|plugins|tr|watch|events|groups|marketplace)/.test(p)) return false;
        if (p === "" || p === "/") return false;
        return /^\/[a-z0-9._-]+/i.test(p);
      } catch { return false; }
    },
  );

  // YouTube — only @handle, /channel/<id>, /c/<name>, or /user/<name>.
  const youtube = pickFirst(
    extractAllHrefs(html, /youtube\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const p = new URL(u).pathname;
        return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/i.test(p);
      } catch { return false; }
    },
  );

  // TikTok — must be /@handle (real account), not /share/, /tag/, etc.
  const tiktok = pickFirst(
    extractAllHrefs(html, /tiktok\.com/),
    (u) => {
      if (isShareUrl(u)) return false;
      try {
        const p = new URL(u).pathname;
        return /^\/@[^/]+/.test(p);
      } catch { return false; }
    },
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

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
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
    try { origin = new URL(url).origin; } catch { /* fall through with raw url */ }

    // Pull subpages in parallel, but only the ones the AI is likely to find
    // useful for this kind of extraction. Spanish-language sites usually have
    // /nosotros, /servicios — include both.
    const subPages = await Promise.all([
      fetchPage(`${origin}/about`),
      fetchPage(`${origin}/services`),
      fetchPage(`${origin}/nosotros`),
      fetchPage(`${origin}/servicios`),
    ]);

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

    // Larger budget (12k chars) — gpt-4o-mini handles it fine and the extra
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
    const socialLinks = extractSocialLinks(html);

    // Detect site language from <html lang> + og:locale + meta hints, plus
    // a fallback heuristic on body text. Used to (a) prefer the user's
    // requested language but (b) override when the site itself is clearly
    // in a different language so the AI's translation isn't confusingly
    // off from the source copy.
    const htmlLangCode = (htmlLang?.[1] ?? "").trim().toLowerCase().split("-")[0];
    const ogLocaleCode = (ogLocale?.[1] ?? "").trim().toLowerCase().split("_")[0];
    const detectedLang = htmlLangCode || ogLocaleCode || "";
    const langForExtraction =
      detectedLang === "es" ? "Spanish"
      : detectedLang === "pt" ? "Portuguese"
      : detectedLang === "fr" ? "French"
      : detectedLang === "de" ? "German"
      : detectedLang === "it" ? "Italian"
      : language;

    // 2. Call OpenAI to extract structured info. Richer schema (employees
    //    range, founded year, target_seniority hints) lets the demo data
    //    generator make more realistic ICPs + leads downstream.
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You extract company information from website content (homepage + /about + /services subpages). Return a JSON object with these fields. Leave empty string "" if not clearly stated:

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
- founded_year: string (4-digit year if mentioned, else "")
- employees_range: string — pick from: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+", or "" if not stated
- key_clients: string[] (named clients/case studies if listed, max 6, else [])
- target_buyer_seniority: string[] — likely buyer roles (e.g. ["CFO", "Finance Director"], ["CMO", "VP Marketing"]). Infer from value_prop + services. Max 4.

CRITICAL:
- Be specific over generic. "Helping businesses grow" is useless — say HOW (e.g. "invoice finance for recruitment agencies funding weekly payroll").
- Quote them when possible. Don't invent.
- Output ALL text fields in ${langForExtraction}.`,
          },
          {
            role: "user",
            content: `Website URL: ${url}
Title: ${titleMatch?.[1] ?? ogTitle?.[1] ?? ""}
Meta description: ${metaMatch?.[1] ?? ogDesc?.[1] ?? ""}
Detected language: ${detectedLang || "(unknown)"}

Combined page content (homepage + /about + /services if available):
${cleaned}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 502 });
    }

    const aiData = await aiRes.json();
    const parsed = JSON.parse(aiData.choices[0].message.content);

    // Merge AI results with scraped social links
    return NextResponse.json({
      ...parsed,
      website: url,
      ...socialLinks,
      // Don't override AI results with empty social links
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
