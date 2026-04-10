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

  // ── Build rich step descriptions with full narrative context ──

  const channelCounters: Record<string, number> = {};
  const allStepsSoFar: { channel: string; type: string }[] = [];
  let cumulativeDay = 0;

  const steps = (sequence ?? []).map((s, i) => {
    cumulativeDay += i === 0 ? 0 : s.daysAfter;
    channelCounters[s.channel] = (channelCounters[s.channel] ?? 0) + 1;
    const nth = channelCounters[s.channel];
    const totalForChannel = sequence.filter(x => x.channel === s.channel).length;
    const isLastForChannel = nth === totalForChannel;

    // Build what happened before this step
    const previousTouchpoints = allStepsSoFar.length > 0
      ? `\n    Previous touchpoints: ${allStepsSoFar.map((p, j) => `Step ${j + 1} (${p.channel}: ${p.type})`).join(" → ")}`
      : "\n    This is the FIRST touchpoint. The prospect has never heard from you.";

    let msgType = "";
    let narrative = "";

    if (s.channel === "linkedin") {
      if (nth === 1) {
        msgType = "CONNECTION REQUEST";
        narrative = `The prospect does NOT know you yet. Send a connection request.
    Rules: Max 300 characters. Be curious about THEM, not about selling. Mention something specific about their company, role, or a recent post to show you did your research. No pitch, no links, no "I'd love to connect" cliches.`;
      } else if (nth === 2) {
        msgType = "FIRST DM POST-CONNECTION";
        narrative = `The prospect ACCEPTED your connection request. This is your first direct message.
    Rules: Max 1000 characters. Do NOT say "thanks for connecting" or "thanks for accepting" — it's robotic. Instead, lead with a specific insight about their industry or company, then bridge to how your company addresses that exact challenge. End with a soft question, not a hard CTA.`;
      } else if (isLastForChannel) {
        msgType = "BREAKUP MESSAGE";
        narrative = `This is your LAST LinkedIn touch. The prospect has received ${nth - 1} previous LinkedIn messages and hasn't engaged.
    Rules: Max 500 characters. Respectful, no guilt. Offer one final piece of value (insight, resource). Leave the door open. "No worries if the timing isn't right" tone.`;
      } else {
        msgType = "FOLLOW-UP DM";
        narrative = `This is follow-up #${nth - 1} after your initial DM. The prospect hasn't replied yet.
    Rules: Max 800 characters. Do NOT repeat your previous pitch. Bring something NEW: a case study result, a specific stat, a relevant industry trend, or social proof. Reference what you said before briefly, then add new value.`;
      }
    } else if (s.channel === "email") {
      if (nth === 1) {
        msgType = "COLD EMAIL";
        narrative = `${allStepsSoFar.some(p => p.channel === "linkedin") ? "The prospect may have seen your LinkedIn outreach. This is your first EMAIL." : "This is a cold email. The prospect has never heard from you."}
    Rules: Subject line max 60 chars — curiosity-driven, no spam words, no ALL CAPS, no exclamation marks. Body: 3-5 SHORT paragraphs. Open with something specific about THEM (not about you), bridge to their pain point, explain your solution briefly with a concrete result, end with a low-friction CTA (15-min call, not "schedule a demo").`;
      } else if (nth === 2) {
        msgType = "FOLLOW-UP EMAIL";
        narrative = `Following up on your first email. The prospect hasn't replied.
    Rules: Subject should feel like a reply thread ("Re: " style or continuation). Keep it SHORT — 2-3 sentences max. Add ONE new piece of value they didn't see in the first email (a case study, a stat, a competitor insight). Don't re-explain who you are.`;
      } else if (isLastForChannel) {
        msgType = "BREAKUP EMAIL";
        narrative = `This is your LAST email. The prospect hasn't engaged with any previous emails.
    Rules: 2-3 sentences max. "Last message" tone but NOT guilt-trippy. Create soft urgency by referencing a specific result or opportunity they're missing. Close gracefully.`;
      } else {
        msgType = "NURTURE EMAIL";
        narrative = `This is a value-add email. The prospect hasn't replied to previous emails.
    Rules: Do NOT pitch again. Instead, provide genuine value: share an insight about their industry, a relevant trend, a framework, or a data point. The CTA is soft — "thought this might be relevant" tone.`;
      }
    } else if (s.channel === "call") {
      if (nth === 1) {
        msgType = "FIRST CALL SCRIPT";
        narrative = `${allStepsSoFar.length > 0 ? "The prospect has received previous outreach on other channels. Reference it briefly." : "This is a cold call."}
    Rules: Bullet point format. Include: opener (who you are + why calling in 1 sentence), 2-3 discovery questions about their pain points, value pitch (30 seconds max), meeting ask. Be conversational, not scripted.`;
      } else {
        msgType = "FOLLOW-UP CALL SCRIPT";
        narrative = `Follow-up call. The prospect has had ${allStepsSoFar.length} previous touchpoints.
    Rules: Bullet points. Reference a specific previous touchpoint. Bring a new angle or urgency. Ask for a meeting.`;
      }
    }

    allStepsSoFar.push({ channel: s.channel, type: msgType });

    return `STEP ${i + 1} | Day ${cumulativeDay} | ${s.channel.toUpperCase()} | ${msgType}
    ${narrative}${previousTouchpoints}`;
  });

  // ── Build lead-specific intelligence section ──

  let leadIntelligence = "";
  if (lead) {
    const dataPoints: string[] = [];

    if (lead.recent_linkedin_post || lead.company_linkedin_post) {
      dataPoints.push(`RECENT LINKEDIN POST: "${(lead.recent_linkedin_post ?? lead.company_linkedin_post).slice(0, 300)}"`);
    }
    if (lead.recent_website_news) {
      dataPoints.push(`RECENT NEWS: "${lead.recent_website_news.slice(0, 300)}"`);
    }
    if (lead.website_summary) {
      dataPoints.push(`WEBSITE SUMMARY: ${lead.website_summary}`);
    }
    if (lead.industry_trends) {
      dataPoints.push(`INDUSTRY TRENDS: ${lead.industry_trends}`);
    }
    if (lead.company_blog) {
      dataPoints.push(`BLOG CONTENT: "${lead.company_blog.slice(0, 200)}"`);
    }
    if (lead.organization_technologies && (Array.isArray(lead.organization_technologies) ? lead.organization_technologies.length > 0 : lead.organization_technologies)) {
      const tech = Array.isArray(lead.organization_technologies) ? lead.organization_technologies.join(", ") : lead.organization_technologies;
      dataPoints.push(`TECHNOLOGIES USED: ${tech}`);
    }
    if (lead.company_posts_content) {
      dataPoints.push(`SOCIAL MEDIA CONTENT: "${lead.company_posts_content.slice(0, 200)}"`);
    }
    if (lead.company_mission) {
      dataPoints.push(`COMPANY MISSION: "${lead.company_mission}"`);
    }

    leadIntelligence = `
## SPECIFIC PROSPECT — USE THIS DATA TO PERSONALIZE EVERY MESSAGE:
Name: ${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}
Company: ${lead.company_name ?? "N/A"}
Role: ${lead.primary_title_role ?? "N/A"}
Seniority: ${lead.primary_seniority ?? "N/A"}
Industry: ${lead.company_industry ?? "N/A"}${lead.company_sub_industry ? ` — ${lead.company_sub_industry}` : ""}
Company Description: ${lead.organization_short_desc ?? lead.organization_description ?? "N/A"}
Company Tagline: ${lead.organization_tagline ?? "N/A"}
Employees: ${lead.employees ?? "N/A"}
Annual Revenue: ${lead.annual_revenue ?? "N/A"}

## RESEARCH INTELLIGENCE (reference this in your messages to show you've done homework):
${dataPoints.length > 0 ? dataPoints.join("\n") : "No additional intelligence available — use the company description and ICP pain points."}

CRITICAL: You MUST weave at least one piece of this research into EACH message. For example:
- Connection request: mention their recent LinkedIn post or a specific company achievement
- First DM: reference an industry trend affecting their sector
- Follow-ups: use their tech stack, blog content, or news to add relevance
DO NOT write generic messages that could apply to anyone. Every message must prove you know THIS specific company.`;
  }

  const personalizationRules = lead
    ? `- Address the prospect by their REAL name (${lead.primary_first_name}) and reference their REAL company (${lead.company_name})
- DO NOT use placeholder variables like {{first_name}} — use actual data
- Each message MUST reference at least one specific data point from the Research Intelligence section`
    : `- Use these personalization variables: {{first_name}}, {{last_name}}, {{company}}, {{role}}
- Write messages that feel specific even with variables — reference the ICP's industry, pain points, and trends`;

  const prompt = `You are a world-class B2B outbound sales copywriter. You write sequences that feel like genuine human outreach, not mass templates.

CRITICAL RULES:
1. Write ALL messages in ENGLISH only.
2. Each message must be DIFFERENT — never repeat the same pitch, angle, or structure across steps.
3. Messages must follow a narrative arc: curiosity → value → proof → urgency.
4. Every message MUST connect the prospect's specific pain points to the sender's specific solution.
5. Be concise. Executives scan, they don't read essays.

## SENDING COMPANY (this is WHO is reaching out):
Company: ${companyBio.company_name}
Industry: ${companyBio.industry || "N/A"}
What they do: ${companyBio.description || "N/A"}
Value Proposition: ${companyBio.value_proposition || "N/A"}
Key Services: ${(companyBio.main_services || []).join(", ") || "N/A"}
Differentiators: ${companyBio.differentiators || "N/A"}
Target Market: ${companyBio.target_market || "N/A"}
Tone of Voice: ${companyBio.tone_of_voice || "Professional but approachable, direct, no corporate jargon"}
Key Clients: ${(companyBio.key_clients || []).join(", ") || "N/A"}
Case Studies: ${(companyBio.case_studies || []).join("; ") || "N/A"}

## TARGET PROSPECT PROFILE (this is WHO you're writing to):
Profile Name: ${icpProfile.profile_name}
Target Industries: ${(icpProfile.target_industries || []).join(", ") || "N/A"}
Target Roles: ${(icpProfile.target_roles || []).join(", ") || "N/A"}
Company Size: ${icpProfile.company_size || "N/A"}
Their Pain Points: ${icpProfile.pain_points || "N/A"}
How We Solve It: ${icpProfile.solutions_offered || "N/A"}
${leadIntelligence}

## THE SEQUENCE — FOLLOW EACH STEP'S RULES EXACTLY:

${steps.join("\n\n")}

## PERSONALIZATION RULES:
${personalizationRules}

## OUTPUT FORMAT (respond ONLY with valid JSON, no markdown, no explanation):
{
  "messages": [
    {"step": 1, "channel": "linkedin", "subject": null, "body": "message text here"},
    {"step": 2, "channel": "email", "subject": "subject line here", "body": "email body here"}
  ]
}

Generate exactly ${sequence.length} messages in order. "subject" is only for email channel (null for linkedin and call).`;

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
          {
            role: "system",
            content: "You are an expert B2B outbound sales copywriter. You write messages in English that feel personal, human, and research-driven — never templated. Each message in a sequence must be distinct and build on the previous one narratively. Always respond with valid JSON only.",
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
