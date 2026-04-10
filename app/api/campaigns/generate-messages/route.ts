import { NextRequest, NextResponse } from "next/server";

type SequenceStep = { channel: string; daysAfter: number };

export async function POST(req: NextRequest) {
  const { sequence, companyBio, icpProfile, lead, language } = await req.json() as {
    sequence: SequenceStep[];
    companyBio: any;
    icpProfile: any;
    lead?: any;
    language?: string;
  };

  const langMap: Record<string, string> = {
    en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian",
  };
  const lang = langMap[language ?? "en"] ?? "English";

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  // ── Classify each step ──
  const channelCounters: Record<string, number> = {};
  let introduced = false;
  let cumDay = 0;

  const stepDescriptions = (sequence ?? []).map((s, i) => {
    cumDay += i === 0 ? 0 : s.daysAfter;
    channelCounters[s.channel] = (channelCounters[s.channel] ?? 0) + 1;
    const nth = channelCounters[s.channel];
    const totalForCh = sequence.filter(x => x.channel === s.channel).length;
    const isLast = nth === totalForCh;

    let type = "";
    if (s.channel === "linkedin") {
      if (nth === 1) type = "LINKEDIN_CONNECTION_REQUEST";
      else if (!introduced) { type = "LINKEDIN_INTRO_DM"; introduced = true; }
      else if (isLast) type = "LINKEDIN_BREAKUP";
      else { type = "LINKEDIN_FOLLOWUP"; }
    } else if (s.channel === "email") {
      if (!introduced) { type = "EMAIL_INTRO"; introduced = true; }
      else if (nth === 1) type = "EMAIL_FOLLOWUP_CROSS";
      else if (isLast) type = "EMAIL_BREAKUP";
      else type = "EMAIL_FOLLOWUP";
    } else if (s.channel === "call") {
      if (nth === 1) type = "CALL_FIRST";
      else type = "CALL_FOLLOWUP";
      if (!introduced) introduced = true;
    }

    return { step: i + 1, day: cumDay, channel: s.channel, type };
  });

  // ── Company info ──
  const co = companyBio;
  const companyBlock = `SENDER: ${co.company_name}
Does: ${co.description || co.value_proposition || "N/A"}
Services: ${(co.main_services || []).join(", ") || "N/A"}
Differentiators: ${co.differentiators || "N/A"}
Clients: ${(co.key_clients || []).join(", ") || "N/A"}
Case studies: ${(co.case_studies || []).join("; ") || "N/A"}
Tone: ${co.tone_of_voice || "Professional, direct"}`;

  // ── ICP info ──
  const icp = icpProfile;
  const icpBlock = `TARGET: ${icp.profile_name}
Industries: ${(icp.target_industries || []).join(", ") || "N/A"}
Roles: ${(icp.target_roles || []).join(", ") || "N/A"}
Pain points: ${icp.pain_points || "N/A"}
Our solution: ${icp.solutions_offered || "N/A"}`;

  // ── Lead-specific data ──
  let leadBlock = "";
  if (lead) {
    const parts = [
      `Name: ${lead.primary_first_name} ${lead.primary_last_name}`,
      `Company: ${lead.company_name ?? "N/A"} (${lead.company_industry ?? "N/A"})`,
      `Role: ${lead.primary_title_role ?? "N/A"}`,
    ];
    if (lead.organization_short_desc || lead.organization_description)
      parts.push(`About: ${(lead.organization_short_desc ?? lead.organization_description).slice(0, 200)}`);
    if (lead.recent_linkedin_post || lead.company_linkedin_post)
      parts.push(`Recent LinkedIn post: "${(lead.recent_linkedin_post ?? lead.company_linkedin_post).slice(0, 200)}"`);
    if (lead.recent_website_news)
      parts.push(`Recent news: "${lead.recent_website_news.slice(0, 200)}"`);
    if (lead.industry_trends)
      parts.push(`Industry trends: ${lead.industry_trends.slice(0, 200)}`);
    if (lead.organization_technologies) {
      const tech = Array.isArray(lead.organization_technologies) ? lead.organization_technologies.join(", ") : lead.organization_technologies;
      if (tech) parts.push(`Tech stack: ${tech}`);
    }
    if (lead.website_summary)
      parts.push(`Website: ${lead.website_summary.slice(0, 150)}`);
    if (lead.company_mission)
      parts.push(`Mission: "${lead.company_mission.slice(0, 150)}"`);

    leadBlock = `\nPROSPECT DATA (use real names, no {{variables}}):\n${parts.join("\n")}`;
  }

  const varsNote = lead
    ? "Use the prospect's real name and company. No {{variables}}."
    : "Use {{first_name}}, {{last_name}}, {{company}}, {{role}} as placeholders.";

  // ── Build the sequence description ──
  const seqLines = stepDescriptions.map(s => `Step ${s.step} | Day ${s.day} | ${s.channel} | ${s.type}`).join("\n");

  const prompt = `Write a ${sequence.length}-message B2B outreach sequence in ${lang}.

${companyBlock}

${icpBlock}
${leadBlock}

SEQUENCE:
${seqLines}

MESSAGE TYPE RULES:

LINKEDIN_CONNECTION_REQUEST:
- Max 300 characters. This is a connection request note, NOT a message.
- Ask something about THEM. No pitch, no company mention.
- Example: "Hi {{first_name}}, I've been following how {{company}} is approaching [topic]. Would love to exchange ideas on [specific thing]."

LINKEDIN_INTRO_DM:
- This is the first real message AFTER they accepted the connection. 800-1000 chars.
- NEVER start with "thanks for connecting" or any variation.
- Structure: [Insight about their industry/challenge] → [Introduce yourself and company: who you are, what you do, key services] → [How you solve THEIR specific pain point] → [Social proof/result] → [Soft question]
- Example: "The [industry] space is evolving fast, especially around [pain point]. I'm [name] with ${co.company_name} — we help [target] companies [solution]. We recently helped [client] achieve [result]. Are you seeing similar challenges with [specific problem]?"

LINKEDIN_FOLLOWUP:
- 400-600 chars. They already know who you are — do NOT re-introduce.
- Bring ONE new piece of value: a case study, stat, insight, or relevant trend.
- Reference your previous message briefly, then add something new.

LINKEDIN_BREAKUP:
- 200-400 chars. Last touch. Respectful, no pressure, leave door open.

EMAIL_INTRO:
- Subject: max 60 chars, curiosity-driven, no spam words.
- Body: 3-4 short paragraphs.
- Must introduce who you are and what the company does.
- If LinkedIn preceded this: reference it ("I recently connected with you on LinkedIn...").
- Structure: [Hook about them] → [Who we are + what we do] → [Pain point → solution] → [Proof] → [CTA: quick call]

EMAIL_FOLLOWUP_CROSS:
- Subject: max 60 chars. Body: 3-4 short paragraphs.
- They already received outreach on another channel. Reference it.
- Do NOT re-introduce yourself. Add a NEW angle, case study, or insight.
- End with clear CTA.

EMAIL_FOLLOWUP:
- Subject: "Re:" style. Body: 2-3 sentences max.
- Add one new piece of value. Don't re-explain who you are.

EMAIL_BREAKUP:
- 2-3 sentences. "Last message" tone. Soft urgency, graceful close.

CALL_FIRST / CALL_FOLLOWUP:
- Bullet point script: Opener → Bridge → Questions → Pitch → Ask.

RULES:
- ${varsNote}
- Each message builds on the previous. They are a SEQUENCE, not isolated messages.
- Never repeat the same angle, pitch, or structure across messages.
- Use the prospect's industry, pain points, and research data to personalize.
- Be concise and professional. No fluff, no corporate jargon.

OUTPUT (valid JSON only, no markdown):
{"messages":[{"step":1,"channel":"linkedin","subject":null,"body":"..."},{"step":2,"channel":"email","subject":"...","body":"..."}]}

Generate exactly ${sequence.length} messages. "subject" is null for linkedin and call.`;

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an expert B2B sales copywriter. Write in ${lang}. Follow the message type rules EXACTLY. Each message type has specific rules — do not mix them up. NEVER say "thanks for connecting" in any message. Always respond with valid JSON only.`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 502 });
    }

    const aiData = await aiRes.json();
    const parsed = JSON.parse(aiData.choices[0].message.content);

    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to generate messages" }, { status: 500 });
  }
}
