"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import {
  ArrowLeft, ArrowRight, Check, Share2, Mail, Phone, MessageCircle,
  Loader2, Send, Megaphone, Plus, Trash2, Globe, Settings, AlertTriangle,
} from "lucide-react";
import ChannelMessageConfig, { type ChannelMessages } from "@/components/ChannelMessageConfig";
import SignalPicker from "@/components/SignalPicker";

const gold = C.gold;

import { type StepAttachment } from "@/components/StepAttachments";

type SequenceStep = { channel: string; daysAfter: number; attachments?: StepAttachment[] };

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

const ALL_CHANNEL_OPTIONS = [
  { key: "linkedin",  label: "LinkedIn",  icon: Share2,         color: C.linkedin, short: "LI" },
  { key: "email",     label: "Email",     icon: Mail,           color: C.email,    short: "EM" },
  { key: "call",      label: "Call",      icon: Phone,          color: C.phone,    short: "CA" },
  { key: "whatsapp",  label: "WhatsApp",  icon: MessageCircle,  color: "#25D366",  short: "WA", superAdminOnly: true },
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
  type SellerQuota = { sellerId: string; quota: number };
  const [sellerQuotas, setSellerQuotas] = useState<SellerQuota[]>([]);
  const [icpTemplates, setIcpTemplates] = useState<Array<{ id: string; name: string; description: string | null; sequence_steps: any[]; step_messages: any }>>([]);
  const [aircallNumbers, setAircallNumbers] = useState<{ id: number; name: string; digits: string; country: string }[]>([]);
  const [selectedAircallNumberId, setSelectedAircallNumberId] = useState<number | null>(null);
  // Manual = sequence freezes at the call step until the seller dials.
  // Auto = cron auto-dials + auto-advances past the call step at daysAfter.
  // Default kept as 'auto' to match pre-2026-05-21 behavior.
  const [callAdvanceMode, setCallAdvanceMode] = useState<"auto" | "manual">("auto");

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
    linkedin: number; email: number; call: number; whatsapp: number;
    missing: { linkedin: string[]; email: string[]; call: string[]; whatsapp: string[] };
  }>({ total: 0, linkedin: 0, email: 0, call: 0, whatsapp: 0, missing: { linkedin: [], email: [], call: [], whatsapp: [] } });

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
        const seq = Array.isArray(t.sequence_steps) ? t.sequence_steps as SequenceStep[] : [];
        if (seq.length > 0) setSequence(seq);
        if (t.step_messages && typeof t.step_messages === "object") {
          setChannelMessages(alignTemplateMessages(t.step_messages as ChannelMessages, seq));
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
  // Save-as-template prompt (shown after successful campaign submit)
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplSaveError, setTplSaveError] = useState<string | null>(null);
  const [tplSaved, setTplSaved] = useState(false);
  const [coverageWarningDismissed, setCoverageWarningDismissed] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const channelOptions = ALL_CHANNEL_OPTIONS.filter(c => !c.superAdminOnly || isSuperAdmin);
  const [language, setLanguage] = useState("es");
  const [timezone, setTimezone] = useState("America/Argentina/La_Rioja");

  useEffect(() => {
    async function load() {
  const supabase = getSupabaseBrowser();
      // Resolve the current user's tenant first — sellers + bio queries below
      // both filter by it. Without this scope, every tenant's seller list leaks
      // into every other tenant's wizard (e.g. Graeme appearing in SWL's flow).
      const { data: authBioId } = await supabase.rpc("get_auth_company_bio_id");
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from("user_profiles").select("tier").eq("id", user.id).single();
        if (prof?.tier === "super_admin") setIsSuperAdmin(true);
      }
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
      if (sellerList && sellerList.length > 0) {
        setSellerQuotas([{ sellerId: sellerList[0].id, quota: 20 }]);
      }

      // Load saved templates for this ICP
      try {
        const tplRes = await fetch(`/api/templates?icp_id=${profileId}`, { cache: "no-store" });
        if (tplRes.ok) {
          const tplBody = await tplRes.json().catch(() => ({}));
          setIcpTemplates(tplBody.templates ?? []);
        }
      } catch {}

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
        .select("id, primary_first_name, primary_last_name, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_secondary_phone, allow_linkedin, allow_email, allow_call")
        .eq("icp_profile_id", profileId);
      if (isPartialSelection) coverageQ = coverageQ.in("id", selectedLeadIds);
      const { data: covRows } = await coverageQ;
      const rows = covRows ?? [];
      const isValidLi = (u: string | null) => !!u && /linkedin\.com\/in\//i.test(u);
      const fullName = (r: any) => `${r.primary_first_name ?? ""} ${r.primary_last_name ?? ""}`.trim() || "Unknown";
      const okLi   = (r: any) => isValidLi(r.primary_linkedin_url) && r.allow_linkedin !== false;
      const okMail = (r: any) => (r.primary_work_email || r.primary_personal_email) && r.allow_email !== false;
      const okCall = (r: any) => r.primary_phone && r.allow_call !== false;
      const okWa   = (r: any) => (r.primary_phone || r.primary_secondary_phone) && r.allow_call !== false;
      const cov = {
        total: rows.length,
        linkedin:  rows.filter(okLi).length,
        email:     rows.filter(okMail).length,
        call:      rows.filter(okCall).length,
        whatsapp:  rows.filter(okWa).length,
        missing: {
          linkedin: rows.filter((r: any) => !okLi(r)).map(fullName),
          email:    rows.filter((r: any) => !okMail(r)).map(fullName),
          call:     rows.filter((r: any) => !okCall(r)).map(fullName),
          whatsapp: rows.filter((r: any) => !okWa(r)).map(fullName),
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

  // classifySteps() (ChannelMessageConfig) maps ALL sequence steps including LinkedIn D0
  // as classified[0] = "First DM (Post-Connection)". Template step_messages.steps[] starts
  // from seq[1] because the AI generator only stores the CR separately. Prepend an empty
  // LinkedIn placeholder so steps[i] aligns with classified[i] on render.
  function alignTemplateMessages(msgs: ChannelMessages, seq: SequenceStep[]): ChannelMessages {
    const isLinkedInD0 = seq[0]?.channel === "linkedin" && seq[0]?.daysAfter === 0;
    const steps = msgs.steps ?? [];
    const firstIsNotLinkedIn = steps.length > 0 && steps[0]?.channel !== "linkedin";
    if (isLinkedInD0 && firstIsNotLinkedIn) {
      return { ...msgs, steps: [{ step: 0, channel: "linkedin", body: "", subject: undefined } as any, ...steps] };
    }
    return msgs;
  }

  // ICP template apply helper (used by the in-wizard dropdown)
  function applyTemplate(tpl: { name: string; sequence_steps: any[]; step_messages: any }) {
    const seq = (tpl.sequence_steps ?? []) as SequenceStep[];
    if (seq.length > 0) setSequence(seq);
    if (tpl.step_messages && typeof tpl.step_messages === "object") {
      setChannelMessages(alignTemplateMessages(tpl.step_messages as ChannelMessages, seq));
    }
    if (!campaignName.trim()) setCampaignName(tpl.name);
  }

  // Multi-seller quota helpers
  const SELLER_COLORS = [
    { bg: "#DBEAFE", text: "#1D4ED8" },
    { bg: "#EDE9FE", text: "#6D28D9" },
    { bg: "#FEF3C7", text: "#92400E" },
    { bg: "#DCFCE7", text: "#166534" },
    { bg: "#FCE7F3", text: "#9D174D" },
  ];

  function addSellerQuota() {
    const used = new Set(sellerQuotas.map(q => q.sellerId));
    const next = sellers.find(s => !used.has(s.id));
    if (!next) return;
    setSellerQuotas(prev => [...prev, { sellerId: next.id, quota: 20 }]);
  }
  function updateSellerQuota(idx: number, patch: Partial<SellerQuota>) {
    setSellerQuotas(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }
  function removeSellerQuota(idx: number) {
    setSellerQuotas(prev => prev.filter((_, i) => i !== idx));
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
      message_prompts: { sequence, channelMessages, language, timezone, selectedLeadIds: isPartialSelection ? selectedLeadIds : null, sellerId: sellerQuotas[0]?.sellerId ?? null, sellerQuotas: sellerQuotas.length > 0 ? sellerQuotas : null, aircallNumberId: selectedAircallNumberId, callAdvanceMode },
      status: "pending_review",
    };
    const { error } = await supabase.from("campaign_requests").insert(insertData);
    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
    } else {
      setSubmitting(false);
      // Offer to save as a reusable template before showing the success screen.
      setTplName(campaignName.trim() || insertData.name);
      setTplDesc("");
      setTplSaveError(null);
      setShowSavePrompt(true);
    }
  }

  async function handleSaveTemplate(skip: boolean) {
    if (skip) { setShowSavePrompt(false); setSubmitted(true); return; }
    setSavingTpl(true);
    setTplSaveError(null);
    try {
      const body: Record<string, unknown> = {
        mode: "from_scratch",
        name: tplName.trim() || campaignName.trim(),
        description: tplDesc.trim() || null,
        icp_profile_id: profileId,
        sequence_steps: sequence,
        step_messages: channelMessages,
        channels: [...new Set(sequence.map(s => s.channel))],
      };
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTplSaveError(json.error ?? "Failed to save template");
        setSavingTpl(false);
        return; // keep modal open so user sees the error
      }
      setTplSaved(true);
      setShowSavePrompt(false);
      setSubmitted(true);
    } catch (e: any) {
      setTplSaveError((e as any)?.message ?? "Unexpected error");
    } finally {
      setSavingTpl(false);
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
              {icpTemplates.length > 0 && (
                <div className="mb-3">
                  <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: gold }}>
                    Saved templates for this ICP
                  </label>
                  <select
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value;
                      if (!id) return;
                      try {
                        const res = await fetch(`/api/templates/${id}`, { cache: "no-store" });
                        if (!res.ok) return;
                        const { template } = await res.json();
                        if (template) applyTemplate(template);
                      } catch {}
                    }}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`, color: C.textPrimary }}>
                    <option value="">— Pick a saved template —</option>
                    {icpTemplates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 mt-3" style={{ color: C.textMuted }}>
                    Generic presets
                  </p>
                </div>
              )}
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
                  <div key={i} className="rounded-lg border px-4 py-3"
                    style={{ borderColor: C.border, backgroundColor: i === 0 ? `${ch.color}06` : "transparent" }}>
                    <div className="flex items-center gap-3">

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
                            {[...new Set([s.daysAfter, 1, 2, 3, 4, 5, 7, 10, 14, 21])].sort((a, b) => a - b).map(d => (
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
              const usedChannels = [...new Set(sequence.map(s => s.channel))] as Array<"linkedin" | "email" | "call" | "whatsapp">;
              const gaps = usedChannels
                .map(ch => ({ ch, reachable: coverage[ch], blockedNames: coverage.missing[ch] }))
                .filter(x => x.blockedNames.length > 0);
              if (gaps.length === 0 || coverage.total === 0 || coverageWarningDismissed) return null;
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
                    <button onClick={() => setCoverageWarningDismissed(true)}
                      className="shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1"
                      style={{ color: "#92400E" }}>
                      ✕
                    </button>
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
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setSequence(s => s.filter(step => step.channel !== g.ch))}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors hover:bg-red-50"
                                style={{ borderColor: "#DC2626", color: "#DC2626" }}>
                                Remove {label(g.ch)} steps
                              </button>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                                style={{ backgroundColor: "#DC2626", color: "#fff" }}>
                                {g.blockedNames.length} blocked
                              </span>
                            </div>
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
        const selectedSellerObj = sellers.find(s => s.id === (sellerQuotas[0]?.sellerId ?? ""));

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

              {/* Multi-seller with quotas */}
              {(() => {
                const totalCap = sellerQuotas.reduce((s, q) => s + q.quota, 0);
                const unallocated = leadsCount - totalCap;
                const isOver = totalCap > leadsCount && leadsCount > 0;
                const isExact = totalCap === leadsCount && leadsCount > 0;

                function handleQuotaChange(idx: number, raw: string) {
                  const val = Math.max(1, parseInt(raw || "1", 10));
                  // With 2 sellers auto-fill the other to cover the total
                  if (sellerQuotas.length === 2 && leadsCount > 0) {
                    const otherIdx = idx === 0 ? 1 : 0;
                    const otherVal = Math.max(1, leadsCount - val);
                    setSellerQuotas(prev => prev.map((q, i) =>
                      i === idx ? { ...q, quota: val } : i === otherIdx ? { ...q, quota: otherVal } : q
                    ));
                  } else {
                    updateSellerQuota(idx, { quota: val });
                  }
                }

                return (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: C.textMuted }}>Assigned Sellers</label>
                        <p className="text-xs mt-0.5" style={{ color: C.textDim }}>
                          {leadsCount > 0 ? `${leadsCount} leads to distribute` : "Set how many leads each seller handles."}
                        </p>
                      </div>
                      {sellerQuotas.length < sellers.length && (
                        <button onClick={addSellerQuota}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md border inline-flex items-center gap-1 shrink-0"
                          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
                          <Plus size={11} /> Add seller
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {sellerQuotas.length === 0 && (
                        <p className="text-xs text-center py-3 rounded-lg border border-dashed" style={{ color: C.textDim, borderColor: C.border }}>
                          No sellers added yet. Click <b>Add seller</b>.
                        </p>
                      )}
                      {sellerQuotas.map((q, idx) => {
                        const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                        const usedIds = new Set(sellerQuotas.filter((_, i) => i !== idx).map(x => x.sellerId));
                        const sellerObj = sellers.find(s => s.id === q.sellerId);
                        const needsLinkedin = usedChannels.includes("linkedin");
                        const missingLinkedin = needsLinkedin && !sellerObj?.unipile_account_id;
                        const pct = leadsCount > 0 ? Math.round((q.quota / leadsCount) * 100) : 0;
                        return (
                          <div key={idx} className="rounded-xl border px-4 py-3"
                            style={{ borderColor: clr.text + "35", backgroundColor: clr.bg + "50" }}>
                            <div className="flex items-center gap-3">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: clr.text }} />
                              <select value={q.sellerId}
                                onChange={e => updateSellerQuota(idx, { sellerId: e.target.value })}
                                className="text-sm font-medium rounded-lg border px-2 py-1.5 outline-none flex-1"
                                style={{ borderColor: clr.text + "25", backgroundColor: "white", color: C.textBody }}>
                                {sellers.filter(s => s.id === q.sellerId || !usedIds.has(s.id)).map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <input type="number" min={1} max={leadsCount || undefined} value={q.quota}
                                  onChange={e => handleQuotaChange(idx, e.target.value)}
                                  className="w-16 text-sm font-bold rounded-lg border px-2 py-1.5 outline-none tabular-nums text-center"
                                  style={{ borderColor: clr.text + "40", backgroundColor: "white", color: clr.text }} />
                                <span className="text-xs" style={{ color: C.textMuted }}>leads</span>
                                {leadsCount > 0 && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ backgroundColor: clr.text + "18", color: clr.text }}>
                                    {pct}%
                                  </span>
                                )}
                              </div>
                              {missingLinkedin && (
                                <span className="text-[9px] font-bold shrink-0" style={{ color: C.red }}>No LinkedIn</span>
                              )}
                              {sellerQuotas.length > 1 && (
                                <button onClick={() => removeSellerQuota(idx)} className="p-1 rounded shrink-0 opacity-30 hover:opacity-100 transition-opacity"
                                  style={{ color: C.red }}>
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>

                            {/* Per-seller progress bar */}
                            {leadsCount > 0 && (
                              <div className="mt-2.5 ml-5">
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: clr.text + "18" }}>
                                  <div className="h-full rounded-full transition-all duration-200"
                                    style={{ width: `${Math.min(100, pct)}%`, backgroundColor: clr.text }} />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Total summary bar */}
                    {sellerQuotas.length > 0 && leadsCount > 0 && (
                      <div className="mt-3 rounded-xl border px-4 py-3" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                        {/* Stacked bar */}
                        <div className="flex h-2 rounded-full overflow-hidden mb-2.5 gap-px">
                          {sellerQuotas.map((q, idx) => {
                            const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                            const w = Math.min(100, (q.quota / leadsCount) * 100);
                            return <div key={idx} className="h-full transition-all duration-200" style={{ width: `${w}%`, backgroundColor: clr.text }} />;
                          })}
                          {unallocated > 0 && (
                            <div className="h-full flex-1" style={{ backgroundColor: C.border }} />
                          )}
                        </div>
                        {/* Legend */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-wrap">
                            {sellerQuotas.map((q, idx) => {
                              const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                              const sel = sellers.find(s => s.id === q.sellerId);
                              return (
                                <span key={idx} className="flex items-center gap-1 text-[10px] font-semibold">
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: clr.text }} />
                                  <span style={{ color: C.textMuted }}>{sel?.name ?? "—"} · {q.quota}</span>
                                </span>
                              );
                            })}
                          </div>
                          <span className="text-[11px] font-bold tabular-nums"
                            style={{ color: isExact ? C.green : isOver ? C.red : "#D97706" }}>
                            {totalCap}/{leadsCount}
                            {isExact && " ✓"}
                            {isOver && " · over cap"}
                            {!isExact && !isOver && ` · ${unallocated} unassigned`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Channel accounts (based on selected seller + used channels) */}
              {sellerQuotas.length > 0 && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Channel Accounts</label>
                  <p className="text-xs mb-4" style={{ color: C.textDim }}>These accounts will be used to send messages for each channel in your sequence.</p>
                  <div className="space-y-3">
                    {usedChannels.map(ch => {
                      const meta = channelOptions.find(c => c.key === ch);
                      if (!meta) return null;
                      const Icon = meta.icon;

                      // For LinkedIn: collect all assigned sellers with a Unipile account.
                      // For other channels: single shared account.
                      if (ch === "linkedin") {
                        const assignedSellers = sellerQuotas
                          .map(q => sellers.find(s => s.id === q.sellerId))
                          .filter(Boolean) as typeof sellers;
                        const withLi = assignedSellers.filter(s => s.unipile_account_id);
                        const missingLi = assignedSellers.filter(s => !s.unipile_account_id);
                        const isConfigured = withLi.length > 0;
                        return (
                          <div key={ch} className="rounded-xl border p-4"
                            style={{ borderColor: isConfigured ? `${meta.color}30` : C.red + "30", backgroundColor: isConfigured ? `${meta.color}04` : `${C.red}04` }}>
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
                                <Icon size={18} style={{ color: meta.color }} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>LinkedIn</p>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {withLi.map(s => (
                                    <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                                      style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                                      {s.name}
                                    </span>
                                  ))}
                                  {missingLi.map(s => (
                                    <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                                      style={{ backgroundColor: C.redLight, color: C.red }}>
                                      {s.name} — no account
                                    </span>
                                  ))}
                                </div>
                              </div>
                              {isConfigured ? (
                                <span className="text-[10px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: C.greenLight, color: C.green }}>
                                  <Check size={10} /> Ready
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: C.redLight, color: C.red }}>
                                  Missing
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      let accountLabel = "Not configured";
                      let isConfigured = false;

                      if (ch === "email") {
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
                      <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Call Step Behavior</label>
                      <p className="text-xs mb-3" style={{ color: C.textDim }}>What happens when a lead reaches a call step in the sequence.</p>
                      <div className="grid grid-cols-2 gap-3 mb-5">
                        {([
                          { key: "auto", title: "Auto-advance", desc: "If the seller doesn't dial within the wait window, the cron auto-dials and the sequence moves to the next step regardless. Best for high-volume top-of-funnel." },
                          { key: "manual", title: "Wait for seller", desc: "Sequence freezes at the call step until the seller dials manually. Lead stays put — no LinkedIn or email follow-up fires until the call happens. Best for high-value leads where the call is the deliberate gate." },
                        ] as const).map(opt => {
                          const isSelected = callAdvanceMode === opt.key;
                          return (
                            <button
                              key={opt.key}
                              onClick={() => setCallAdvanceMode(opt.key)}
                              className="rounded-xl border p-4 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                              style={{
                                borderColor: isSelected ? C.phone : C.border,
                                backgroundColor: isSelected ? `${C.phone}08` : "transparent",
                                boxShadow: isSelected ? `0 0 0 1px ${C.phone}` : "none",
                              }}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{opt.title}</span>
                                {isSelected && <Check size={13} style={{ color: C.phone }} />}
                              </div>
                              <p className="text-[11px] leading-snug" style={{ color: C.textMuted }}>{opt.desc}</p>
                            </button>
                          );
                        })}
                      </div>
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
            onAttachmentsChange={(stepIdx, next) => {
              setSequence(seq => seq.map((step, i) => i === stepIdx ? { ...step, attachments: next } : step));
            }}
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
      {/* Save-as-template prompt — shown right after submit, before the success screen */}
      {showSavePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="rounded-2xl border p-7 w-full max-w-md shadow-2xl fade-in"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "#FEF3C7" }}>
              <span style={{ fontSize: 22 }}>📋</span>
            </div>
            <h2 className="text-lg font-bold mb-1" style={{ color: C.textPrimary }}>Save as template?</h2>
            <p className="text-sm mb-5" style={{ color: C.textMuted }}>
              Reuse this sequence and messages for future outreach flows.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Template name</label>
                <input
                  value={tplName}
                  onChange={e => setTplName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. LinkedIn + Email 5-step"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Description <span className="font-normal">(optional)</span></label>
                <input
                  value={tplDesc}
                  onChange={e => setTplDesc(e.target.value)}
                  maxLength={200}
                  placeholder="Short note about this template…"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
                />
              </div>
              {tplSaveError && (
                <p className="text-xs" style={{ color: C.red }}>{tplSaveError}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSaveTemplate(true)}
                disabled={savingTpl}
                className="flex-1 rounded-lg py-2.5 text-sm font-medium"
                style={{ backgroundColor: C.surface, color: C.textBody }}>
                Skip
              </button>
              <button
                onClick={() => handleSaveTemplate(false)}
                disabled={savingTpl || !tplName.trim()}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ backgroundColor: gold, color: "#04070d", opacity: (!tplName.trim() || savingTpl) ? 0.6 : 1 }}>
                {savingTpl ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

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
            {tplSaved && (
              <p className="text-xs mb-1 font-medium" style={{ color: C.green }}>
                Template &ldquo;{tplName}&rdquo; saved.
              </p>
            )}
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
              if (wizardStep === 1 && sellerQuotas.length === 0) {
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
