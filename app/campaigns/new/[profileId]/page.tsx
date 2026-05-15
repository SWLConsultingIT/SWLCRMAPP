"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import {
  ArrowLeft, ArrowRight, Check, Share2, Mail, Phone,
  Loader2, Send, Megaphone, Plus, Trash2, Globe, Settings, AlertTriangle,
} from "lucide-react";
import ChannelMessageConfig, { type ChannelMessages } from "@/components/ChannelMessageConfig";
import SignalPicker from "@/components/SignalPicker";

const gold = C.gold;

type SequenceStep = { channel: string; daysAfter: number };

const timezoneOptions = [
  { value: "America/Argentina/La_Rioja", label: "Buenos Aires (UTC-3)" },
  { value: "America/Sao_Paulo", label: "São Paulo (UTC-3)" },
  { value: "America/Mexico_City", label: "Mexico City (UTC-6)" },
  { value: "America/Santiago", label: "Santiago (UTC-4)" },
  { value: "America/Bogota", label: "Bogotá (UTC-5)" },
  { value: "America/Lima", label: "Lima (UTC-5)" },
  { value: "America/New_York", label: "New York (UTC-5)" },
  { value: "America/Chicago", label: "Chicago (UTC-6)" },
  { value: "America/Denver", label: "Denver (UTC-7)" },
  { value: "America/Los_Angeles", label: "Los Angeles (UTC-8)" },
  { value: "Europe/London", label: "London (UTC+0)" },
  { value: "Europe/Madrid", label: "Madrid (UTC+1)" },
  { value: "Europe/Paris", label: "Paris (UTC+1)" },
  { value: "Europe/Berlin", label: "Berlin (UTC+1)" },
  { value: "Asia/Dubai", label: "Dubai (UTC+4)" },
  { value: "Asia/Kolkata", label: "Mumbai (UTC+5:30)" },
  { value: "Asia/Singapore", label: "Singapore (UTC+8)" },
  { value: "Asia/Tokyo", label: "Tokyo (UTC+9)" },
  { value: "Australia/Sydney", label: "Sydney (UTC+10)" },
];

const languageOptions = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
];

const channelOptions = [
  { key: "linkedin", label: "LinkedIn", icon: Share2, color: C.linkedin, short: "LI" },
  { key: "email",    label: "Email",    icon: Mail,   color: C.email,    short: "EM" },
  { key: "call",     label: "Call",     icon: Phone,  color: C.phone,    short: "CA" },
];

const sequenceTemplates = [
  {
    name: "LinkedIn Only",
    desc: "3-step LinkedIn sequence",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "LinkedIn + Email",
    desc: "Alternate between LinkedIn and Email",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "email", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "email", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "Email Only",
    desc: "4-step email sequence",
    steps: [
      { channel: "email", daysAfter: 0 },
      { channel: "email", daysAfter: 3 },
      { channel: "email", daysAfter: 4 },
      { channel: "email", daysAfter: 5 },
    ],
  },
  {
    name: "Multichannel Aggressive",
    desc: "LinkedIn + Email + Call combo",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "email", daysAfter: 2 },
      { channel: "call", daysAfter: 1 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "email", daysAfter: 3 },
      { channel: "call", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "LinkedIn + Call",
    desc: "LinkedIn outreach with call follow-ups",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "call", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "call", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
];

const WIZARD_STEPS = ["Sequence", "Settings", "Messages", "Review"];

export default function NewCampaignWizard() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const profileId = params.profileId as string;

  // Selected lead IDs from URL (?leads=id1,id2,id3)
  const selectedLeadIds = searchParams.get("leads")?.split(",").filter(Boolean) ?? [];
  const isPartialSelection = selectedLeadIds.length > 0;

  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [bio, setBio] = useState<any>(null);
  const [leadsCount, setLeadsCount] = useState(0);
  const [selectedLeadNames, setSelectedLeadNames] = useState<string[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string; unipile_account_id: string | null; email_account: string | null; linkedin_daily_limit: number | null; email_daily_limit: number | null }[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>("");
  const [aircallNumbers, setAircallNumbers] = useState<{ id: number; name: string; digits: string; country: string }[]>([]);
  const [selectedAircallNumberId, setSelectedAircallNumberId] = useState<number | null>(null);

  // Channel coverage across the leads chosen for this campaign. Counted once
  // up front so the Sequence step can warn the operator BEFORE launch when
  // a channel is in the flow but some leads are missing the data for it
  // (no LinkedIn URL, no email, no phone). Without this guard, those leads
  // sit silently and the dispatcher fails them at send time, which is what
  // happened on Pathway 2026-05-11 — admin discovered 9 BLOCKED only after
  // they showed up in Failed Messages.
  //
  // missing[channel] holds the names of leads that CAN'T be reached on that
  // channel — used in the warning so admin sees exactly who's blocked, not
  // just an aggregate count.
  const [coverage, setCoverage] = useState<{
    total: number;
    linkedin: number; email: number; call: number;
    missing: { linkedin: string[]; email: string[]; call: string[] };
  }>({ total: 0, linkedin: 0, email: 0, call: 0, missing: { linkedin: [], email: [], call: [] } });

  // Sequence builder
  const [sequence, setSequence] = useState<SequenceStep[]>([
    { channel: "linkedin", daysAfter: 0 },
    { channel: "email", daysAfter: 3 },
    { channel: "linkedin", daysAfter: 3 },
  ]);

  // Channel messages (structured per-channel config)
  const [channelMessages, setChannelMessages] = useState<ChannelMessages>({ steps: [], autoReplies: { positive: "", negative: "", question: "" } });

  // Template apply — checks both the URL (?template_id=X for direct deep
  // links from elsewhere) and sessionStorage (set by the /templates tab
  // before navigating through the chooser, since the URL param doesn't
  // survive the 2-step navigation). The wizard pre-fills sequence +
  // channelMessages, then clears sessionStorage so refreshing doesn't
  // reapply it.
  useEffect(() => {
    const fromUrl = searchParams.get("template_id");
    let fromSession: string | null = null;
    try { fromSession = sessionStorage.getItem("swl-pending-template-id"); } catch { /* SSR/private mode */ }
    const templateId = fromUrl ?? fromSession;
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/templates/${templateId}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        const t = body.template;
        if (cancelled || !t) return;
        if (Array.isArray(t.sequence_steps) && t.sequence_steps.length > 0) {
          setSequence(t.sequence_steps as SequenceStep[]);
        }
        if (t.step_messages && typeof t.step_messages === "object") {
          setChannelMessages(t.step_messages as ChannelMessages);
        }
        try { sessionStorage.removeItem("swl-pending-template-id"); } catch { /* no-op */ }
      } catch { /* template apply is best-effort; never block the wizard */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  // Enrichment from a representative lead in this ICP — drives which signal chips render.
  // Each tenant has different enrichment keys; for Pathway they're rfa_*/ch_*, for another client they might be something else.
  const [sampleEnrichment, setSampleEnrichment] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [messagesWarning, setMessagesWarning] = useState<string | null>(null);
  const [language, setLanguage] = useState("es");
  const [timezone, setTimezone] = useState("America/Argentina/La_Rioja");

  useEffect(() => {
    async function load() {
  const supabase = getSupabaseBrowser();
      // Resolve the current user's tenant first — sellers + bio queries below
      // both filter by it. Without this scope, every tenant's seller list leaks
      // into every other tenant's wizard (e.g. Graeme appearing in SWL's flow).
      const { data: authBioId } = await supabase.rpc("get_auth_company_bio_id");
      const bioId = (authBioId as string | null) ?? null;
      const sellerQ = supabase.from("sellers")
        .select("id, name, unipile_account_id, email_account, linkedin_daily_limit, email_daily_limit")
        .eq("active", true)
        .order("name");
      // Tenant scope: own sellers + sellers shared from other tenants via the
      // admin "Sellers shared with this client" toggle. The OR clause keeps
      // the wizard tenant-isolated while honoring shared assignments.
      if (bioId) sellerQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`);
      const bioQ = bioId
        ? supabase.from("company_bios").select("*").eq("id", bioId).single()
        : supabase.from("company_bios").select("*").order("created_at", { ascending: false }).limit(1).single();
      const [{ data: p }, { data: b }, { data: sellerList }] = await Promise.all([
        supabase.from("icp_profiles").select("*").eq("id", profileId).single(),
        bioQ,
        sellerQ,
      ]);
      setSellers(sellerList ?? []);
      if (sellerList?.length === 1) setSelectedSeller(sellerList[0].id);

      // Fetch Aircall numbers
      try {
        const r = await fetch("/api/aircall/numbers");
        const d = await r.json();
        setAircallNumbers(d.numbers ?? []);
        if (d.numbers?.length === 1) setSelectedAircallNumberId(d.numbers[0].id);
      } catch {}

      // Count leads + channel coverage in one pass. We fetch the channel-relevant
      // columns for the selected/profile leads and tally per-channel availability.
      // Cheap: 4 fields × ~100 rows = a few KB. Keeps the Sequence step honest
      // about whether a chosen channel will actually reach all the leads.
      let coverageQ = supabase
        .from("leads")
        .select("id, primary_first_name, primary_last_name, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, allow_linkedin, allow_email, allow_call")
        .eq("icp_profile_id", profileId);
      if (isPartialSelection) coverageQ = coverageQ.in("id", selectedLeadIds);
      const { data: covRows } = await coverageQ;
      const rows = covRows ?? [];
      const isValidLi = (u: string | null) => !!u && /linkedin\.com\/in\//i.test(u);
      const fullName = (r: any) => `${r.primary_first_name ?? ""} ${r.primary_last_name ?? ""}`.trim() || "Unknown";
      const okLi   = (r: any) => isValidLi(r.primary_linkedin_url) && r.allow_linkedin !== false;
      const okMail = (r: any) => (r.primary_work_email || r.primary_personal_email) && r.allow_email !== false;
      const okCall = (r: any) => r.primary_phone && r.allow_call !== false;
      const cov = {
        total: rows.length,
        linkedin: rows.filter(okLi).length,
        email:    rows.filter(okMail).length,
        call:     rows.filter(okCall).length,
        missing: {
          linkedin: rows.filter((r: any) => !okLi(r)).map(fullName),
          email:    rows.filter((r: any) => !okMail(r)).map(fullName),
          call:     rows.filter((r: any) => !okCall(r)).map(fullName),
        },
      };
      setCoverage(cov);

      let count = rows.length;
      if (isPartialSelection) {
        setSelectedLeadNames(rows.map((n: any) => `${n.primary_first_name ?? ""} ${n.primary_last_name ?? ""}`.trim()));
      } else if (count === 0) {
        // Defensive: profile may have leads but we read 0 — fall back to count query.
        const { count: totalCount } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("icp_profile_id", profileId);
        count = totalCount ?? 0;
      }

      // Grab a representative lead's enrichment so the SignalPicker shows only keys
      // that actually exist on leads belonging to this ICP (Pathway leads have rfa_*/ch_*;
      // another client's leads have whatever vocabulary they use).
      let sampleQuery = supabase
        .from("leads")
        .select("enrichment")
        .eq("icp_profile_id", profileId)
        .not("enrichment", "is", null)
        .limit(1);
      if (isPartialSelection) sampleQuery = sampleQuery.in("id", selectedLeadIds);
      const { data: sample } = await sampleQuery.maybeSingle();
      setSampleEnrichment((sample?.enrichment as Record<string, unknown> | null) ?? null);

      setProfile(p);
      setBio(b);
      setLeadsCount(count ?? 0);
      setLoading(false);
    }
    load();
  }, [profileId]);

  // Sequence helpers
  function addStep() {
    const lastChannel = sequence.length > 0 ? sequence[sequence.length - 1].channel : "linkedin";
    const nextChannel = channelOptions.find(c => c.key !== lastChannel)?.key ?? lastChannel;
    setSequence(s => [...s, { channel: nextChannel, daysAfter: 3 }]);
  }

  function removeStep(idx: number) {
    setSequence(s => s.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, field: keyof SequenceStep, value: any) {
    setSequence(s => s.map((step, i) => i === idx ? { ...step, [field]: value } : step));
  }

  // Calculate cumulative days
  function cumulativeDays(): number[] {
    let day = 0;
    return sequence.map((s, i) => {
      if (i === 0) { day = s.daysAfter; return s.daysAfter; }
      day += s.daysAfter;
      return day;
    });
  }

  // Submit
  async function handleSubmit() {
    const supabase = getSupabaseBrowser();
    setSubmitting(true);
    setSubmitError(null);

    // Tenant-isolation RLS on campaign_requests requires company_bio_id = the caller's tenant.
    // Resolve it from the signed-in user's profile; admins without a tenant can't submit here.
    const { data: companyBioId, error: scopeErr } = await supabase.rpc("get_auth_company_bio_id");
    if (scopeErr || !companyBioId) {
      setSubmitError(scopeErr?.message ?? "Your account has no company assigned — contact an admin.");
      setSubmitting(false);
      return;
    }

    const uniqueChannels = [...new Set(sequence.map(s => s.channel))];
    const insertData: Record<string, any> = {
      name: campaignName.trim() || `${profile?.profile_name} — ${uniqueChannels.map(c => channelOptions.find(o => o.key === c)?.label).join(" + ")}`,
      icp_profile_id: profileId,
      company_bio_id: companyBioId,
      channels: uniqueChannels,
      sequence_length: sequence.length,
      frequency_days: 0,
      target_leads_count: leadsCount,
      message_prompts: { sequence, channelMessages, language, timezone, selectedLeadIds: isPartialSelection ? selectedLeadIds : null, sellerId: selectedSeller || null, aircallNumberId: selectedAircallNumberId },
      status: "pending_review",
    };
    const { error } = await supabase.from("campaign_requests").insert(insertData);
    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
    } else {
      setSubmitted(true);
      setSubmitting(false);
    }
  }

  const days = cumulativeDays();
  const totalDays = days.length > 0 ? days[days.length - 1] : 0;

  if (loading) {
    return <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}><Loader2 size={20} className="animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="p-6 w-full">
      {/* Header — single-line meta, smaller h1, tighter gaps (UX pass 2026-05-15). */}
      <button onClick={() => router.push("/campaigns")} className="flex items-center gap-1.5 text-[11px] font-medium mb-2 transition-colors hover:opacity-80" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Back to Campaigns
      </button>
      <div className="mb-4 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-[20px] font-bold flex items-center gap-2" style={{ color: C.textPrimary }}>
          <Megaphone size={18} style={{ color: gold }} /> Configure Outreach Flow
        </h1>
        <p className="text-xs" style={{ color: C.textMuted }}>
          {profile?.profile_name} · {leadsCount} {isPartialSelection ? "selected" : ""} lead{leadsCount === 1 ? "" : "s"}
        </p>
      </div>
      {isPartialSelection && selectedLeadNames.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {selectedLeadNames.slice(0, 8).map((name, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>{name}</span>
          ))}
          {selectedLeadNames.length > 8 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: C.bg, color: C.textMuted }}>
              +{selectedLeadNames.length - 8} more
            </span>
          )}
        </div>
      )}

      <div className="h-px mb-5" style={{ background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-6">
        {WIZARD_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <button onClick={() => i < wizardStep && setWizardStep(i)} disabled={i > wizardStep}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={i === wizardStep ? { backgroundColor: gold, color: "#04070d" } : i < wizardStep ? { backgroundColor: C.greenLight, color: C.green } : { backgroundColor: C.surface, color: C.textDim }}>
              {i < wizardStep ? <Check size={12} /> : <span>{i + 1}</span>}
              {s}
            </button>
            {i < WIZARD_STEPS.length - 1 && <div className="w-6 h-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* ═══ STEP 0: SEQUENCE BUILDER (with flow name) ═══ */}
      {wizardStep === 0 && (
        <div className="space-y-4">
          {/* Flow name + templates combined — 2 visual fragments collapsed into
              one card to reduce stacked-card noise. */}
          <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: C.textMuted }}>Flow Name</label>
            <input
              type="text"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="e.g. LATAM SaaS Leaders — LinkedIn + Email"
              className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold focus:outline-none"
              style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}
            />
            <div className="mt-4 pt-4 border-t" style={{ borderColor: C.border }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Start from a template</p>
              <div className="flex gap-2 flex-wrap">
                {sequenceTemplates.map(tpl => (
                  <button key={tpl.name}
                    onClick={() => { setSequence(tpl.steps.map(s => ({ ...s }))); setChannelMessages({ steps: [], autoReplies: { positive: "", negative: "", question: "" } }); }}
                    className="rounded-lg border px-3 py-2 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                    style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <p className="text-[12px] font-semibold" style={{ color: C.textPrimary }}>{tpl.name}</p>
                    <p className="text-[11px]" style={{ color: C.textDim }}>{tpl.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Build Your Sequence</h2>
                <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>Define the channel and timing for each step. Pick a template above or customize freely.</p>
              </div>
              <div className="text-right">
                <p className="text-[11px]" style={{ color: C.textMuted }}>{sequence.length} steps · ~{totalDays} days</p>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {sequence.map((s, i) => {
                const ch = channelOptions.find(c => c.key === s.channel)!;
                const Icon = ch.icon;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: C.border, backgroundColor: i === 0 ? `${ch.color}06` : "transparent" }}>

                    {/* Step number */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: `${ch.color}15`, color: ch.color }}>
                      {i + 1}
                    </div>

                    {/* Channel select */}
                    <div className="flex items-center gap-2">
                      {channelOptions.map(opt => {
                        const OptIcon = opt.icon;
                        const selected = s.channel === opt.key;
                        return (
                          <button key={opt.key} onClick={() => updateStep(i, "channel", opt.key)}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-[opacity,transform,box-shadow,background-color,border-color]"
                            style={selected
                              ? { backgroundColor: opt.color, color: "#fff" }
                              : { backgroundColor: C.surface, color: C.textMuted }
                            }>
                            <OptIcon size={12} />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Days after */}
                    <div className="flex items-center gap-2 ml-auto">
                      {i === 0 ? (
                        <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: C.greenLight, color: C.green }}>
                          Day 0 — Immediate
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs" style={{ color: C.textMuted }}>Wait</span>
                          <select className="rounded-lg border px-2 py-1.5 text-xs font-medium focus:outline-none"
                            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg, minWidth: 65 }}
                            value={s.daysAfter} onChange={e => updateStep(i, "daysAfter", Number(e.target.value))}>
                            {[1, 2, 3, 4, 5, 7, 10, 14, 21].map(d => (
                              <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>
                            ))}
                          </select>
                          <span className="text-xs tabular-nums" style={{ color: C.textDim }}>
                            (Day {days[i]})
                          </span>
                        </div>
                      )}

                      {/* Remove */}
                      {sequence.length > 1 && (
                        <button onClick={() => removeStep(i)} className="ml-2 opacity-30 hover:opacity-100 transition-opacity"
                          style={{ color: C.red }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add step */}
            <button onClick={addStep}
              className="flex items-center gap-2 mt-3 rounded-lg px-4 py-2.5 text-xs font-medium w-full justify-center transition-opacity hover:opacity-80 border border-dashed"
              style={{ borderColor: C.border, color: C.textMuted }}>
              <Plus size={14} /> Add Step
            </button>
          </div>

          {/* Timeline preview */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Timeline Preview</p>
            <div className="relative">
              {/* Line */}
              <div className="absolute left-3 top-3 bottom-3 w-0.5" style={{ backgroundColor: C.border }} />

              <div className="space-y-4">
                {sequence.map((s, i) => {
                  const ch = channelOptions.find(c => c.key === s.channel)!;
                  const Icon = ch.icon;
                  return (
                    <div key={i} className="flex items-center gap-4 relative">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10"
                        style={{ backgroundColor: ch.color }}>
                        <Icon size={12} color="#fff" />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
                            {ch.label} — Step {i + 1}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {i === 0 ? "Sent immediately" : `${s.daysAfter} days after previous step`}
                          </p>
                        </div>
                        <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: `${ch.color}12`, color: ch.color }}>
                          Day {days[i]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-xs mt-4 pt-3 border-t" style={{ borderColor: C.border, color: C.textMuted }}>
              {leadsCount} leads · {sequence.length} steps · {totalDays} days · {[...new Set(sequence.map(s => s.channel))].length} channels
            </p>

            {/* Channel coverage warnings — surface missing data BEFORE launch.
                Per-channel breakdown with the actual lead names that will be
                blocked. Different leads may fail on different channels (a lead
                with email-only but no LinkedIn appears under LinkedIn only). */}
            {(() => {
              const usedChannels = [...new Set(sequence.map(s => s.channel))] as Array<"linkedin" | "email" | "call">;
              const gaps = usedChannels
                .map(ch => ({ ch, reachable: coverage[ch], blockedNames: coverage.missing[ch] }))
                .filter(x => x.blockedNames.length > 0);
              if (gaps.length === 0 || coverage.total === 0) return null;
              const label = (ch: string) => channelOptions.find(o => o.key === ch)?.label ?? ch;
              const color = (ch: string) => channelOptions.find(o => o.key === ch)?.color ?? "#64748B";
              const PREVIEW = 6;
              return (
                <div className="mt-4 rounded-lg border p-4"
                  style={{ borderColor: "#FDE68A", backgroundColor: "#FFFBEB" }}>
                  <div className="flex items-start gap-2.5 mb-3">
                    <AlertTriangle size={16} style={{ color: "#D97706" }} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-bold mb-0.5" style={{ color: "#92400E" }}>
                        Some leads can&apos;t be reached on every channel in this sequence.
                      </p>
                      <p className="text-xs" style={{ color: "#92400E" }}>
                        For each channel below, the listed leads will sit blocked on the steps that use it — they won&apos;t fail loudly, they just won&apos;t send. A lead with only email and no LinkedIn would appear under LinkedIn only.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 pl-7">
                    {gaps.map(g => {
                      const shown = g.blockedNames.slice(0, PREVIEW);
                      const extra = g.blockedNames.length - shown.length;
                      return (
                        <div key={g.ch} className="rounded-md border bg-white p-2.5"
                          style={{ borderColor: "#FDE68A" }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: color(g.ch) }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color(g.ch) }} />
                              {label(g.ch)}
                              <span className="font-medium" style={{ color: "#78350F" }}>
                                · {g.reachable} / {coverage.total} reachable
                              </span>
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={{ backgroundColor: "#DC2626", color: "#fff" }}>
                              {g.blockedNames.length} blocked
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {shown.map((n, idx) => (
                              <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: "#F3F4F6", color: "#374151" }}>{n}</span>
                            ))}
                            {extra > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                style={{ color: "#78350F" }}>+ {extra} more</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ STEP 1: SETTINGS (Seller + Channel Accounts) ═══ */}
      {wizardStep === 1 && (() => {
        const usedChannels = [...new Set(sequence.map(s => s.channel))];
        const selectedSellerObj = sellers.find(s => s.id === selectedSeller);

        return (
          <div className="space-y-5">
            <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
              <div className="flex items-center gap-2 mb-1">
                <Settings size={15} style={{ color: gold }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Flow Settings</h2>
              </div>
              <p className="text-xs mb-6" style={{ color: C.textDim }}>
                Choose who will run this outreach flow and which accounts to use for each channel.
              </p>

              {/* Seller selection */}
              <div className="mb-6">
                <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Assigned Seller</label>
                <p className="text-xs mb-3" style={{ color: C.textDim }}>
                  {usedChannels.length === 1 && usedChannels[0] === "call"
                    ? "Any seller can run a call-only flow (Aircall is shared). This person will own the lead."
                    : usedChannels.length === 1 && usedChannels[0] === "email"
                    ? "Any seller can run an email-only flow (Instantly pool is shared)."
                    : "This person will handle follow-ups and conversations for this flow."}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {sellers.map(s => {
                    const isActive = selectedSeller === s.id;
                    const hasLinkedin = !!s.unipile_account_id;
                    const hasEmail = !!s.email_account;
                    const needsLinkedin = usedChannels.includes("linkedin");
                    const missingLinkedin = needsLinkedin && !hasLinkedin;
                    return (
                      <button key={s.id} onClick={() => !missingLinkedin && setSelectedSeller(s.id)}
                        disabled={missingLinkedin}
                        className="rounded-xl border p-4 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          borderColor: isActive ? gold : C.border,
                          backgroundColor: isActive ? `color-mix(in srgb, ${gold} 2%, transparent)` : "transparent",
                          boxShadow: isActive ? `0 0 0 1px ${gold}` : "none",
                        }}>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                            style={{ background: isActive ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` : C.bg, color: isActive ? "#fff" : C.textMuted }}>
                            {s.name[0]}
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{s.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {hasLinkedin && <span className="text-[9px] flex items-center gap-0.5" style={{ color: C.linkedin }}><Share2 size={8} /> LinkedIn</span>}
                              {hasEmail && <span className="text-[9px] flex items-center gap-0.5" style={{ color: C.email }}><Mail size={8} /> Email</span>}
                              <span className="text-[9px] flex items-center gap-0.5" style={{ color: C.phone }}><Phone size={8} /> Call</span>
                              {missingLinkedin && <span className="text-[9px] font-bold" style={{ color: C.red }}>· LinkedIn needed</span>}
                            </div>
                          </div>
                        </div>
                        {isActive && <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: gold }}><Check size={10} /> Selected</div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel accounts (based on selected seller + used channels) */}
              {selectedSeller && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Channel Accounts</label>
                  <p className="text-xs mb-4" style={{ color: C.textDim }}>These accounts will be used to send messages for each channel in your sequence.</p>
                  <div className="space-y-3">
                    {usedChannels.map(ch => {
                      const meta = channelOptions.find(c => c.key === ch);
                      if (!meta) return null;
                      const Icon = meta.icon;

                      let accountValue: string | null = null;
                      let accountLabel = "Not configured";
                      let isConfigured = false;

                      if (ch === "linkedin" && selectedSellerObj?.unipile_account_id) {
                        accountValue = selectedSellerObj.unipile_account_id;
                        accountLabel = `Unipile — ${selectedSellerObj.name}`;
                        isConfigured = true;
                      } else if (ch === "email") {
                        accountValue = "instantly_pool";
                        accountLabel = "Instantly — Shared pool";
                        isConfigured = true;
                      } else if (ch === "call") {
                        accountLabel = "Aircall — shared SWL number";
                        isConfigured = true;
                      }

                      return (
                        <div key={ch} className="flex items-center gap-4 rounded-xl border p-4"
                          style={{ borderColor: isConfigured ? `${meta.color}30` : C.red + "30", backgroundColor: isConfigured ? `${meta.color}04` : `${C.red}04` }}>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
                            <Icon size={18} style={{ color: meta.color }} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{meta.label}</p>
                            <p className="text-xs" style={{ color: isConfigured ? C.textMuted : C.red }}>
                              {accountLabel}
                            </p>
                          </div>
                          {isConfigured ? (
                            <span className="text-[10px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ backgroundColor: C.greenLight, color: C.green }}>
                              <Check size={10} /> Ready
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: C.redLight, color: C.red }}>
                              Missing
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {usedChannels.includes("call") && (
                    <div className="mt-4">
                      <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Aircall Number</label>
                      <p className="text-xs mb-3" style={{ color: C.textDim }}>Which outbound number will be used for call steps in this sequence.</p>
                      {aircallNumbers.length === 0 ? (
                        <div className="rounded-lg border px-4 py-3 text-xs" style={{ backgroundColor: C.redLight, borderColor: `${C.red}30`, color: C.red }}>
                          No Aircall numbers available for this account.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {aircallNumbers.map(n => {
                            const isSelected = selectedAircallNumberId === n.id;
                            const flags: Record<string, string> = { DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽", ES: "🇪🇸", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧" };
                            return (
                              <button
                                key={n.id}
                                onClick={() => setSelectedAircallNumberId(n.id)}
                                className="rounded-xl border p-4 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm flex items-center gap-3"
                                style={{
                                  borderColor: isSelected ? C.phone : C.border,
                                  backgroundColor: isSelected ? `${C.phone}08` : "transparent",
                                  boxShadow: isSelected ? `0 0 0 1px ${C.phone}` : "none",
                                }}
                              >
                                <span className="text-2xl shrink-0">{flags[n.country] ?? "📞"}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{n.name || n.country}</p>
                                  <p className="text-xs tabular-nums" style={{ color: C.textMuted }}>{n.digits}</p>
                                </div>
                                {isSelected && <Check size={14} style={{ color: C.phone }} />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedSellerObj && (
                    <div className="mt-4 rounded-lg px-4 py-3 flex items-center gap-3" style={{ backgroundColor: C.bg }}>
                      <span className="text-xs" style={{ color: C.textMuted }}>Daily limits for {selectedSellerObj.name}:</span>
                      {usedChannels.includes("linkedin") && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${C.linkedin}12`, color: C.linkedin }}>
                          LinkedIn: {selectedSellerObj.linkedin_daily_limit ?? 15}/day
                        </span>
                      )}
                      {usedChannels.includes("email") && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${C.email}12`, color: C.email }}>
                          Email: {selectedSellerObj.email_daily_limit ?? "∞"}/day
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═══ STEP 2: CHANNEL MESSAGE CONFIG ═══ */}
      {wizardStep === 2 && (
        <div className="space-y-5">
          <div className="rounded-xl border px-5 py-3 flex items-center gap-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Globe size={13} style={{ color: C.textMuted }} />
            <span className="text-xs font-medium" style={{ color: C.textMuted }}>Language:</span>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}>
              {languageOptions.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <span className="text-xs font-medium" style={{ color: C.textMuted }}>Timezone:</span>
            <select value={timezone} onChange={e => setTimezone(e.target.value)}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}>
              {timezoneOptions.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <span className="text-xs flex-1 text-right" style={{ color: C.textDim }}>
              Configure messages per channel. Use AI to generate or write manually.
            </span>
          </div>
          <p className="text-xs" style={{ color: C.textMuted }}>
            Variables: {"{{first_name}}, {{last_name}}, {{company}}, {{role}}"} — replaced per lead at send time. Plus any ICP-specific signals you tick below (e.g. credit rating, trade debtors) will be woven in per lead.
          </p>
          <SignalPicker
            enrichment={sampleEnrichment}
            selected={selectedSignals}
            onChange={setSelectedSignals}
          />
          <ChannelMessageConfig
            channelMessages={channelMessages}
            onChange={setChannelMessages}
            sequence={sequence}
            language={language}
            icpProfileId={profileId}
            signals={selectedSignals}
          />
        </div>
      )}

      {/* ═══ STEP 3: REVIEW ═══ */}
      {wizardStep === 3 && (
        <div className="space-y-5">
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Flow Summary</h2>

            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Profile</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{profile?.profile_name}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Leads</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{leadsCount} prospects</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Duration</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{sequence.length} steps · {totalDays} days</p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ═══ POST-SUBMIT SUCCESS SCREEN ═══ */}
      {submitted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="rounded-2xl border p-8 w-full max-w-md shadow-2xl text-center fade-in"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ backgroundColor: C.greenLight }}>
              <Check size={32} style={{ color: C.green }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: C.textPrimary }}>Flow Submitted</h2>
            <p className="text-sm mb-1" style={{ color: C.textBody }}>
              Your outreach flow has been submitted for review.
            </p>
            <p className="text-sm mb-6" style={{ color: C.textMuted }}>
              The SWL team will review your flow and you will be notified in your <strong>Queue</strong> once it is approved.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => router.push("/leads")}
                className="rounded-lg px-5 py-2.5 text-sm font-medium"
                style={{ backgroundColor: C.surface, color: C.textBody }}>
                Back to Leads
              </button>
              <button onClick={() => router.push("/campaigns")}
                className="rounded-lg px-5 py-2.5 text-sm font-semibold"
                style={{ backgroundColor: gold, color: "#04070d" }}>
                View Campaigns
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warnings & errors */}
      {messagesWarning && (
        <div className="mt-4 rounded-lg border px-4 py-3" style={{ borderColor: "#D97706", backgroundColor: "#FFFBEB" }}>
          <p className="text-sm font-medium" style={{ color: "#D97706" }}>{messagesWarning}</p>
        </div>
      )}
      {submitError && (
        <div className="mt-4 rounded-lg border px-4 py-3" style={{ borderColor: C.red, backgroundColor: C.redLight }}>
          <p className="text-sm font-medium" style={{ color: C.red }}>Failed to create campaign</p>
          <p className="text-xs mt-0.5" style={{ color: C.textBody }}>{submitError}</p>
        </div>
      )}

      {/* ═══ NAVIGATION ═══ */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
        <button onClick={() => wizardStep === 0 ? router.push("/campaigns") : setWizardStep(s => s - 1)}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity"
          style={{ color: C.textBody, backgroundColor: C.surface }}>
          <ArrowLeft size={15} /> {wizardStep === 0 ? "Cancel" : "Previous"}
        </button>

        {wizardStep < WIZARD_STEPS.length - 1 ? (
          <button
            onClick={() => {
              if (wizardStep === 0 && !campaignName.trim()) {
                setMessagesWarning("Please enter a flow name.");
                return;
              }
              if (wizardStep === 0 && sequence.length === 0) {
                setMessagesWarning("Please add at least one step to the sequence.");
                return;
              }
              if (wizardStep === 1 && !selectedSeller) {
                setMessagesWarning("Please select a seller before continuing.");
                return;
              }
              if (wizardStep === 2) {
                const hasAnyContent = channelMessages.steps?.some((s: any) => s.body?.trim());
                if (!hasAnyContent) {
                  setMessagesWarning("Please write or generate at least one message before continuing.");
                  return;
                }
              }
              setMessagesWarning(null);
              setWizardStep(s => s + 1);
            }}
            disabled={false}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.green, color: "#fff" }}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {submitting ? "Submitting…" : "Launch Flow"}
          </button>
        )}
      </div>
    </div>
  );
}
