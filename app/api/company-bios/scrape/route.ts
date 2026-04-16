import { NextRequest, NextResponse } from "next/server";

const LANG_MAP: Record<string, string> = {
  EN: "English", IT: "Italian", ES: "Spanish", FR: "French", DE: "German",
};

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

    // Extract social links from HTML
    const linkedinMatch = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'\s]+)["']/i);
    const instagramMatch = html.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s]+)["']/i);
    const twitterMatch = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s]+)["']/i);
    const facebookMatch = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+)["']/i);
    const youtubeMatch = html.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/[^"'\s]+)["']/i);
    const tiktokMatch = html.match(/href=["'](https?:\/\/(?:www\.)?tiktok\.com\/@[^"'\s]+)["']/i);

    const socialLinks = {
      linkedin_url: linkedinMatch?.[1] ?? "",
      instagram_url: instagramMatch?.[1] ?? "",
      twitter_url: twitterMatch?.[1] ?? "",
      facebook_url: facebookMatch?.[1] ?? "",
      youtube_url: youtubeMatch?.[1] ?? "",
      tiktok_url: tiktokMatch?.[1] ?? "",
    };

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
