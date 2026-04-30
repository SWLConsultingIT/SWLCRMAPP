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
    // 1. Fetch the website HTML
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SWLBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Could not fetch website (${res.status})` }, { status: 422 });
    }

    const html = await res.text();

    // Strip to meaningful text (remove scripts, styles, keep meta + body text)
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000); // limit tokens

    // Extract meta tags separately for better context
    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);

    // Extract social links from HTML — collect all candidates, then filter out
    // share/intent/sharer URLs (they're widgets pointing to the social network,
    // not the company's own account) and validate per-platform path shape.
    const socialLinks = extractSocialLinks(html);

    // 2. Call OpenAI to extract structured info
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
            content: `You extract company information from website content. Return a JSON object with these fields (leave empty string "" if not found):
- company_name: string
- tagline: string (short slogan or tagline)
- industry: string (e.g. "Consulting", "Technology / SaaS", "Healthcare / Healthtech")
- description: string (2-4 sentences about what the company does)
- value_proposition: string (one sentence: what problem they solve and for whom)
- main_services: string[] (list of main services/products, max 10)
- differentiators: string (what makes them different, bullet points separated by newlines)
- target_market: string (who are their ideal customers)
- location: string (city, country)
- tone_of_voice: string (describe the communication style: professional, casual, technical, etc.)

Be concise and factual. Extract only what's clearly stated on the website. Respond with all text fields in ${language}.`,
          },
          {
            role: "user",
            content: `Website URL: ${url}\nTitle: ${titleMatch?.[1] ?? ""}\nMeta description: ${metaMatch?.[1] ?? ogDesc?.[1] ?? ""}\n\nPage content:\n${cleaned}`,
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
