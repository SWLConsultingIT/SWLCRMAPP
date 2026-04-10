import { NextRequest, NextResponse } from "next/server";

type SequenceStep = { channel: string; daysAfter: number };

export async function POST(req: NextRequest) {
  const { sequence, companyBio, icpProfile, lead } = await req.json() as {
    sequence: SequenceStep[];
    companyBio: any;
    icpProfile: any;
    lead?: any;
  };

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  // Build sequence description with message types
  const channelCounters: Record<string, number> = {};
  const steps = (sequence ?? []).map((s, i) => {
    channelCounters[s.channel] = (channelCounters[s.channel] ?? 0) + 1;
    const nth = channelCounters[s.channel];
    let msgType = "";

    if (s.channel === "linkedin") {
      if (nth === 1) msgType = "CONNECTION REQUEST — max 300 chars. Short, personal, mention why you want to connect. No selling yet.";
      else if (nth === 2) msgType = "FIRST MESSAGE POST-CONNECTION — they accepted your request. Now introduce your value. Mention their pain point and how you solve it. Max 1000 chars.";
      else if (nth === channelCounters[s.channel]) msgType = "BREAKUP MESSAGE — last touch. Respectful, no pressure, leave the door open. Max 500 chars.";
      else msgType = "FOLLOW-UP — add social proof, a case study, or a specific benefit. Reference previous message. Max 800 chars.";
    } else if (s.channel === "email") {
      if (nth === 1) msgType = "COLD EMAIL — needs strong subject line (max 60 chars, no spam words). Body: introduce company, mention their specific pain point, propose a quick call. 3-5 short paragraphs.";
      else if (nth === 2) msgType = "FOLLOW-UP EMAIL — subject should be 'Re:' style. Short, reference first email, add one new piece of value (case study, stat, insight).";
      else if (nth === channelCounters[s.channel]) msgType = "BREAKUP EMAIL — 'Last message' style. Brief, respectful, create soft urgency. 2-3 sentences max.";
      else msgType = "NURTURE EMAIL — provide value (insight, relevant article angle, industry trend). Soft CTA.";
    } else if (s.channel === "call") {
      if (nth === 1) msgType = "FIRST CALL SCRIPT — opener (who you are, why calling), discovery questions about their pain points, value pitch, ask for meeting. Bullet point format.";
      else msgType = "FOLLOW-UP CALL SCRIPT — reference previous touchpoints, new angle or urgency, ask for meeting. Bullet points.";
    }

    return `Step ${i + 1} (Day ${s.daysAfter}, ${s.channel}): ${msgType}`;
  });

  // Build lead-specific context if targeting an individual lead
  const leadSection = lead ? `
## SPECIFIC PROSPECT (use their real data — DO NOT use placeholder variables):
Name: ${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}
Company: ${lead.company_name ?? "N/A"}
Role: ${lead.primary_title_role ?? "N/A"}
Seniority: ${lead.primary_seniority ?? "N/A"}
Industry: ${lead.company_industry ?? "N/A"}${lead.company_sub_industry ? ` — ${lead.company_sub_industry}` : ""}
Company Description: ${lead.organization_short_desc ?? lead.organization_description ?? "N/A"}
Company Tagline: ${lead.organization_tagline ?? "N/A"}
Company Mission: ${lead.company_mission ?? "N/A"}
Employees: ${lead.employees ?? "N/A"}
Annual Revenue: ${lead.annual_revenue ?? "N/A"}
Technologies: ${lead.organization_technologies ? (Array.isArray(lead.organization_technologies) ? lead.organization_technologies.join(", ") : lead.organization_technologies) : "N/A"}
Recent LinkedIn Post: ${lead.recent_linkedin_post ?? lead.company_linkedin_post ?? "N/A"}
Recent Website News: ${lead.recent_website_news ?? "N/A"}
Website Summary: ${lead.website_summary ?? "N/A"}
Industry Trends: ${lead.industry_trends ?? "N/A"}
Blog Content: ${lead.company_blog ?? "N/A"}` : "";

  const personalizationRules = lead
    ? `- Address the prospect by their REAL name and reference their REAL company, role, and details
- Reference their recent LinkedIn posts, news, or industry trends when available to show you've done your homework
- DO NOT use placeholder variables like {{first_name}} — use their actual data
- Connect their specific company situation/industry to how the sending company solves their problems`
    : `- Use these personalization variables: {{first_name}}, {{last_name}}, {{company}}, {{role}}`;

  const prompt = `You are a world-class B2B outbound sales copywriter who creates highly personalized outreach sequences. Your messages should feel human, not templated.

## SENDING COMPANY:
Company: ${companyBio.company_name}
Industry: ${companyBio.industry || "N/A"}
What they do: ${companyBio.description || "N/A"}
Value Proposition: ${companyBio.value_proposition || "N/A"}
Key Services: ${(companyBio.main_services || []).join(", ") || "N/A"}
What makes them different: ${companyBio.differentiators || "N/A"}
Target Market: ${companyBio.target_market || "N/A"}
Communication Tone: ${companyBio.tone_of_voice || "Professional but approachable, direct, no corporate jargon"}
Key Clients: ${(companyBio.key_clients || []).join(", ") || "N/A"}
Case Studies: ${(companyBio.case_studies || []).join("; ") || "N/A"}

## TARGET PROSPECT PROFILE:
Profile Name: ${icpProfile.profile_name}
Target Industries: ${(icpProfile.target_industries || []).join(", ") || "N/A"}
Target Roles: ${(icpProfile.target_roles || []).join(", ") || "N/A"}
Company Size: ${icpProfile.company_size || "N/A"}
Their Pain Points: ${icpProfile.pain_points || "N/A"}
How We Solve It: ${icpProfile.solutions_offered || "N/A"}
${leadSection}

## SEQUENCE TO GENERATE:
${steps.join("\n")}

## WRITING RULES:
- Use the company's tone of voice consistently
- Reference specific pain points from the ICP profile and explain HOW the company's services solve them
- Show the prospect you understand their world — mention their industry challenges, not just your product
- Use social proof (key clients, case studies, results) when relevant
- Each message should build on the previous ones — don't repeat the same pitch, escalate value
- LinkedIn connection requests MUST be under 300 characters
${personalizationRules}
- Subject lines for emails: short, curiosity-driven, no spam words
- Call scripts: bullet point format, conversational

## OUTPUT FORMAT (respond ONLY with JSON, no markdown):
{
  "messages": [
    {"step": 1, "channel": "linkedin", "subject": null, "body": "connection request text"},
    {"step": 2, "channel": "email", "subject": "subject line", "body": "email body text"},
    {"step": 3, "channel": "linkedin", "subject": null, "body": "follow up message"}
  ]
}

Generate exactly ${sequence.length} messages in order. Subject is only for email (null for linkedin/call).`;

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an expert B2B outbound sales copywriter. You write messages that feel personal and human, not like mass templates. Always respond with valid JSON only." },
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
