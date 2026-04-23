"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  Share2, Mail, Phone, Check, Pencil, X, Save,
  PlayCircle, Loader2, Pause, Play, Trash2, Send,
  Users, UserPlus, Megaphone, Target, CheckCircle2,
  MessageSquare, PhoneCall, Clock, AlertTriangle, ChevronRight, LayoutGrid,
} from "lucide-react";
import CampaignKanban from "@/components/CampaignKanban";
import CampaignCallsTab from "@/components/CampaignCallsTab";
import { classifyUrgency } from "@/lib/overdue";

const AIRCALL_USERS = [
  { id: 1916199, name: "Francisco Fontana" },
  { id: 1917522, name: "Sales Team" },
];

const gold = "var(--brand, #c9a83a)";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e", label: "WhatsApp" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: C.green,    bg: C.greenLight },
  paused:    { label: "Paused",    color: "#D97706",  bg: "#FFFBEB" },
  completed: { label: "Completed", color: C.textMuted, bg: "#F3F4F6" },
  failed:    { label: "Failed",    color: C.red,      bg: C.redLight },
};

type Message = { id: string; step_number: number; channel: string; content: string; status: string; sent_at: string | null };
type GroupCampaign = { id: string; status: string; channel?: string; current_step: number; sequence_steps: any[] | null; leads: any; sellers: any; _isCurrent?: boolean };
type UnlinkedLead = { id: string; primary_first_name: string | null; primary_last_name: string | null; company_name: string | null; primary_title_role: string | null; lead_score: number | null; allow_linkedin: boolean; allow_email: boolean; allow_call: boolean };
type LeadGroup = { profileName: string; leads: UnlinkedLead[] };

export default function CampaignDetailClient({
  campaignId, campaignName, campaignStatus, campaignIcpId, sellerName, sequence, messages, dayPerStep, currentStep,
  allCampaigns, leadGroups, channels, autoReplies, connectionNote, messageTemplates,
}: {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignIcpId: string | null;
  sellerName: string;
  sequence: { channel: string; daysAfter: number }[];
  messages: Message[];
  dayPerStep: number[];
  currentStep: number;
  allCampaigns: GroupCampaign[];
  leadGroups: LeadGroup[];
  channels: string[];
  autoReplies: { positive?: string; negative?: string; question?: string };
  connectionNote: string;
  messageTemplates: { channel: string; body: string; subject?: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [calledIds, setCalledIds] = useState<Set<string>>(new Set());
  const [selectedUserId, setSelectedUserId] = useState<number>(AIRCALL_USERS[0].id);

  async function handleDial(leadId: string, phone: string) {
    if (!phone || callingId) return;
    setCallingId(leadId);
    try {
      const res = await fetch("/api/aircall/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, leadId, aircallUserId: selectedUserId }),
      });
      if (res.ok) setCalledIds(prev => new Set(prev).add(leadId));
    } finally {
      setCallingId(null);
    }
  }

  const isEditable = campaignStatus === "active" || campaignStatus === "paused";

  async function callAction(ids: string[], action: "pause" | "resume" | "cancel") {
    const r = await fetch("/api/campaigns/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error("campaign action failed:", err);
      throw new Error(err.error ?? "action failed");
    }
  }

  async function act(campId: string, action: "pause" | "resume" | "cancel") {
    setActing(`${campId}:${action}`);
    try { await callAction([campId], action); } catch {}
    setActing(null);
    router.refresh();
  }

  async function bulkAct(action: "pause" | "resume" | "cancel") {
    const ids = selected.size > 0 ? Array.from(selected) : visibleCampaigns.filter(c => ["active", "paused"].includes(c.status)).map(c => c.id);
    if (ids.length === 0) return;
    setActing(`bulk:${action}`);
    try { await callAction(ids, action); } catch {}
    setActing(null);
    setSelected(new Set());
    router.refresh();
  }

  async function addLeadsToCampaign(leadIds: string[]) {
    if (leadIds.length === 0) return;
    setAdding(true);
    // Get seller from first campaign in group
    const firstCamp = allCampaigns[0];
    for (const leadId of leadIds) {
      await supabase.from("campaigns").insert({
        lead_id: leadId,
        seller_id: firstCamp?.sellers?.id ?? null,
        name: campaignName,
        channel: sequence[0]?.channel ?? "linkedin",
        status: "active",
        current_step: 0,
        sequence_steps: sequence,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      await supabase.from("leads").update({ status: "contacted", current_channel: sequence[0]?.channel ?? "linkedin" }).eq("id", leadId);
    }
    setAdding(false);
    setAddSelected(new Set());
    router.refresh();
  }

  async function saveMsg(msgId: string) {
    setSaving(true);
    await fetch(`/api/messages/${msgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editContent }) });
    setEditingIdx(null);
    setSaving(false);
    router.refresh();
  }

  const visibleCampaigns = allCampaigns.filter(c => c.status !== "completed" && c.status !== "failed");

  // ── Next Actions: for every active campaign in the group, compute the next step + urgency ──
  const now = Date.now();
  const nextActions = allCampaigns
    .filter(c => c.status === "active")
    .map(c => {
      const steps = Array.isArray(c.sequence_steps) ? c.sequence_steps : [];
      const nextIdx = c.current_step ?? 0;
      const nextStep = steps[nextIdx];
      if (!nextStep) return null;
      const daysAfter = nextStep.daysAfter ?? 0;
      const lastStepAt = (c as any).last_step_at as string | null;
      const dueAt = lastStepAt ? new Date(lastStepAt).getTime() + daysAfter * 86400000 : null;
      const isOverdue = dueAt !== null && now > dueAt;
      const overdueDays = isOverdue && dueAt ? Math.floor((now - dueAt) / 86400000) : 0;
      return {
        campaignId: c.id,
        leadId: c.leads?.id as string | undefined,
        leadName: `${c.leads?.primary_first_name ?? ""} ${c.leads?.primary_last_name ?? ""}`.trim() || "Unknown",
        company: c.leads?.company_name as string | null,
        phone: c.leads?.primary_phone as string | null,
        channel: nextStep.channel as string,
        stepNumber: nextIdx + 1,
        totalSteps: steps.length,
        dueAt,
        isOverdue,
        overdueDays,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return (a.dueAt ?? 0) - (b.dueAt ?? 0);
    });

  const pendingCalls = nextActions.filter(a => a.channel === "call");
  const overdueCount = nextActions.filter(a => a.isOverdue).length;

  const tabs = [
    { label: "Leads", icon: Users, count: visibleCampaigns.length },
    { label: "Sequence", icon: Megaphone, count: sequence.length },
    { label: "Calls", icon: PhoneCall, count: null },
    { label: "Add Leads", icon: UserPlus, count: leadGroups.reduce((s, g) => s + g.leads.length, 0) },
  ];
  const [leadsView, setLeadsView] = useState<"list" | "kanban">("list");

  return (
    <div>

      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: active ? gold : C.textMuted }}>
              <Icon size={15} /> {t.label}
              {t.count !== null && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: active ? `color-mix(in srgb, ${gold} 8%, transparent)` : "#F3F4F6", color: active ? gold : C.textDim }}>{t.count}</span>
              )}
              {active && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: gold }} />}
            </button>
          );
        })}
      </div>

      {/* ═══ TAB 0: LEADS (list ⇄ kanban) ═══ */}
      {tab === 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {/* View toggle */}
            <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
              <button onClick={() => setLeadsView("list")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all"
                style={{
                  backgroundColor: leadsView === "list" ? `color-mix(in srgb, ${gold} 8%, transparent)` : "transparent",
                  color: leadsView === "list" ? gold : C.textMuted,
                }}>
                <Users size={11} /> List
              </button>
              <button onClick={() => setLeadsView("kanban")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all border-l"
                style={{
                  backgroundColor: leadsView === "kanban" ? `color-mix(in srgb, ${gold} 8%, transparent)` : "transparent",
                  color: leadsView === "kanban" ? gold : C.textMuted,
                  borderColor: C.border,
                }}>
                <LayoutGrid size={11} /> Pipeline
              </button>
            </div>

            <span className="text-xs font-medium ml-2" style={{ color: C.textMuted }}>{selected.size > 0 ? `${selected.size} selected` : "All"}:</span>
            <Link href={`/campaigns/${campaignId}/edit`} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-80" style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}><Pencil size={11} /> Edit</Link>
            {campaignStatus === "active" ? (
              <button onClick={() => bulkAct("pause")} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}><Pause size={11} /> Pause</button>
            ) : campaignStatus === "paused" ? (
              <button onClick={() => bulkAct("resume")} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.greenLight, color: C.green }}><Play size={11} /> Resume</button>
            ) : null}
            <button onClick={() => { if (confirm("Cancel this campaign for " + (selected.size > 0 ? "selected leads" : "all leads") + "?")) bulkAct("cancel"); }} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.redLight, color: C.red }}><Trash2 size={11} /> Cancel</button>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-xs underline ml-1" style={{ color: C.textMuted }}>Clear</button>}
          </div>

          {leadsView === "kanban" ? (
            <CampaignKanban sequence={sequence} campaigns={visibleCampaigns as any} />
          ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: `color-mix(in srgb, var(--brand, #c9a83a) 4%, transparent)` }}>
                  <th className="w-10 px-4 py-3"><input type="checkbox" checked={selected.size === visibleCampaigns.length && visibleCampaigns.length > 0} onChange={() => selected.size === visibleCampaigns.length ? setSelected(new Set()) : setSelected(new Set(visibleCampaigns.map(c => c.id)))} style={{ accentColor: gold }} /></th>
                  {["Lead", "Company", "Role", "Status", "Progress", "Seller", ""].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map(c => {
                  const l = c.leads; if (!l) return null;
                  const nm = `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "Unknown";
                  const cst = statusConfig[c.status] ?? statusConfig.active;
                  const ts = c.sequence_steps?.length ?? 0;
                  const p = ts > 0 ? Math.round((c.current_step / ts) * 100) : 0;
                  const ck = selected.has(c.id);
                  return (
                    <tr key={c.id} className="table-row-hover" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: ck ? `color-mix(in srgb, ${gold} 2%, transparent)` : "transparent" }}>
                      <td className="px-4 py-3"><input type="checkbox" checked={ck} onChange={() => { const n = new Set(selected); ck ? n.delete(c.id) : n.add(c.id); setSelected(n); }} style={{ accentColor: gold }} /></td>
                      <td className="px-4 py-3"><Link href={`/leads/${l.id}`} className="hover:underline"><p className="font-medium" style={{ color: C.textPrimary }}>{nm}</p></Link></td>
                      <td className="px-4 py-3 text-xs" style={{ color: C.textBody }}>{l.company_name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: C.textMuted }}>{l.primary_title_role ?? "—"}</td>
                      <td className="px-4 py-3"><span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: cst.bg, color: cst.color }}>{cst.label}</span></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-16 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}><div className="h-1.5 rounded-full" style={{ width: `${p}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }} /></div><span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{c.current_step}/{ts}</span></div></td>
                      <td className="px-4 py-3 text-xs" style={{ color: C.textBody }}>{c.sellers?.name ?? "—"}</td>
                      <td className="px-4 py-3"><div className="flex gap-1">
                        {c.status === "active" && <button onClick={() => act(c.id, "pause")} disabled={!!acting} className="rounded-md px-2 py-1 text-xs disabled:opacity-50" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}><Pause size={10} /></button>}
                        {c.status === "paused" && <button onClick={() => act(c.id, "resume")} disabled={!!acting} className="rounded-md px-2 py-1 text-xs disabled:opacity-50" style={{ backgroundColor: C.greenLight, color: C.green }}><Play size={10} /></button>}
                        {["active","paused"].includes(c.status) && <>
                          <button onClick={() => { if (confirm(`Remove ${nm}?`)) act(c.id, "cancel"); }} disabled={!!acting} className="rounded-md px-2 py-1 text-xs disabled:opacity-50" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}><Trash2 size={10} /></button>
                        </>}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* ═══ TAB 1: SEQUENCE ═══ */}
      {tab === 1 && (
        <div className="space-y-5">

          {/* Actions row */}
          <div className="flex items-center gap-2">
            <Link href={`/campaigns/${campaignId}/edit`}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold hover:opacity-80"
              style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
              <Pencil size={11} /> Edit Flow
            </Link>
            {sellerName && sellerName !== "Unassigned" && (
              <span className="text-xs" style={{ color: C.textMuted }}>Seller: <strong style={{ color: C.textBody }}>{sellerName}</strong></span>
            )}
            <div className="flex-1" />
            {isEditable && (
              <div className="flex items-center gap-2">
                {campaignStatus === "active" ? (
                  <button onClick={() => act(campaignId, "pause")} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}><Pause size={11} /> Pause</button>
                ) : (
                  <button onClick={() => act(campaignId, "resume")} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.greenLight, color: C.green }}><Play size={11} /> Resume</button>
                )}
                <button onClick={() => { if (confirm("Cancel campaign?")) act(campaignId, "cancel"); }} disabled={!!acting} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.redLight, color: C.red }}><Trash2 size={11} /> Cancel</button>
              </div>
            )}
          </div>

          {/* ── FUNNEL + STATUS 50/50 ── */}
          {(() => {
            const stColor = campaignStatus === "active" ? C.green : campaignStatus === "paused" ? "#D97706" : campaignStatus === "completed" ? C.blue : C.textMuted;
            const stBg    = campaignStatus === "active" ? `${C.green}08` : campaignStatus === "paused" ? "#D9770608" : campaignStatus === "completed" ? `${C.blue}08` : C.bg;
            const stBorder= campaignStatus === "active" ? `${C.green}25` : campaignStatus === "paused" ? "#D9770625" : campaignStatus === "completed" ? `${C.blue}25` : C.border;
            const curMeta = sequence[currentStep] ? (channelMeta[sequence[currentStep].channel] ?? channelMeta.linkedin) : null;

            return (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
                <div className="grid grid-cols-2" style={{ minHeight: "200px" }}>

                  {/* ── LEFT: Funnel ── */}
                  <div className="flex flex-col justify-center gap-0 p-6" style={{ borderRight: `1px solid ${C.border}`, background: `linear-gradient(160deg, ${C.bg} 60%, ${stBg} 100%)` }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-5 text-center" style={{ color: C.textDim }}>Outreach Funnel</p>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                      {sequence.map((step, i) => {
                        const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                        const Icon = meta.icon;
                        const isPast  = i < currentStep;
                        const isCur   = i === currentStep && currentStep < sequence.length;
                        const isFuture= i > currentStep;
                        const n = sequence.length;
                        const w = Math.max(14, 100 - i * (86 / Math.max(n - 1, 1)));
                        const bg = isPast ? meta.color : isCur ? gold : "#94A3B8";
                        return (
                          <div key={i} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <div style={{
                              width: `${w}%`, height: "32px", backgroundColor: bg,
                              borderRadius: i === 0 ? "8px 8px 0 0" : i === n-1 ? "0 0 8px 8px" : "0",
                              opacity: isFuture ? 0.25 : 1,
                              display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", overflow: "hidden",
                              boxShadow: (isPast || isCur) ? `0 2px 8px ${bg}40` : "none",
                            }}>
                              <Icon size={11} color="#fff" />
                              {w > 50 && <span style={{ color: "#fff", fontSize: "10px", fontWeight: 700, letterSpacing: "0.02em" }}>{meta.label}</span>}
                              {isPast && w > 42 && <Check size={10} color="rgba(255,255,255,0.9)" />}
                              {isCur && <span style={{ fontSize: "8px", fontWeight: 800, color: "#fff", backgroundColor: "rgba(255,255,255,0.28)", padding: "1px 5px", borderRadius: "99px", whiteSpace: "nowrap" }}>Now</span>}
                            </div>
                            {i < n - 1 && (
                              <div style={{ width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderTop: `7px solid ${bg}`, opacity: isFuture ? 0.25 : 1 }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Completion line */}
                    {currentStep >= sequence.length && (
                      <div className="mt-4 flex items-center justify-center gap-1.5">
                        <CheckCircle2 size={12} style={{ color: C.green }} />
                        <span style={{ fontSize: "10px", fontWeight: 700, color: C.green }}>All steps completed</span>
                      </div>
                    )}
                  </div>

                  {/* ── RIGHT: Status ── */}
                  <div className="flex flex-col gap-4 p-6" style={{ backgroundColor: C.card }}>
                    {/* Status pill */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-full px-3 py-1 flex items-center gap-1.5 text-xs font-bold"
                        style={{ backgroundColor: stBg, color: stColor, border: `1px solid ${stBorder}` }}>
                        {campaignStatus === "active" && <><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: stColor }} /> Running</>}
                        {campaignStatus === "paused" && <><Pause size={10} /> Paused</>}
                        {campaignStatus === "completed" && currentStep < sequence.length && <><MessageSquare size={10} /> Lead Replied</>}
                        {currentStep >= sequence.length && <><CheckCircle2 size={10} /> Completed</>}
                      </div>
                      <span className="text-xs" style={{ color: C.textDim }}>Step {Math.min(currentStep + 1, sequence.length)} / {sequence.length}</span>
                    </div>

                    {/* Main message */}
                    <div>
                      {campaignStatus === "active" && curMeta && (
                        <>
                          <p className="text-sm font-bold mb-0.5" style={{ color: C.textPrimary }}>
                            Sending via {curMeta.label} on Day {dayPerStep[currentStep] ?? 0}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>Waiting for the scheduled send window</p>
                        </>
                      )}
                      {campaignStatus === "paused" && curMeta && (
                        <>
                          <p className="text-sm font-bold mb-0.5" style={{ color: C.textPrimary }}>
                            Paused before {curMeta.label} · Day {dayPerStep[currentStep] ?? 0}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>Resume to continue from step {currentStep + 1}</p>
                        </>
                      )}
                      {campaignStatus === "completed" && currentStep < sequence.length && (
                        <>
                          <p className="text-sm font-bold mb-0.5" style={{ color: C.textPrimary }}>
                            Stopped at step {currentStep + 1}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>Lead replied — moved to pipeline</p>
                        </>
                      )}
                      {currentStep >= sequence.length && (
                        <>
                          <p className="text-sm font-bold mb-0.5" style={{ color: C.textPrimary }}>
                            All {sequence.length} steps delivered
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>Campaign ran for {dayPerStep[sequence.length - 1] ?? 0} days</p>
                        </>
                      )}
                    </div>

                    {/* Step timeline */}
                    <div className="space-y-2 mt-auto">
                      {sequence.map((step, i) => {
                        const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                        const Icon = meta.icon;
                        const isPast  = i < currentStep;
                        const isCur   = i === currentStep && currentStep < sequence.length;
                        return (
                          <div key={i} className="flex items-center gap-2.5">
                            {/* Step dot */}
                            <div style={{ width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, backgroundColor: isPast ? meta.color : isCur ? gold : "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {isPast ? <Check size={9} color="#fff" /> : isCur ? <PlayCircle size={9} color="#fff" /> : <span style={{ fontSize: "8px", color: "#94A3B8", fontWeight: 700 }}>{i + 1}</span>}
                            </div>
                            {/* Channel badge */}
                            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: meta.color, backgroundColor: `${meta.color}12`, padding: "1px 6px", borderRadius: "4px" }}>
                              <Icon size={9} /> {meta.label}
                            </span>
                            <span style={{ fontSize: "10px", color: C.textDim }}>Day {dayPerStep[i] ?? 0}</span>
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: "10px", fontWeight: 600, color: isPast ? C.green : isCur ? gold : C.textDim }}>
                              {isPast ? "Sent" : isCur ? "Up next" : "Pending"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* ── STEPS ACCORDION ── */}
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            {(() => {
              // If step_number 0 exists (connection request slot), sequence steps are offset by 1
              const hasConnReqSlot = messages.some(m => m.step_number === 0);
              const stepOffset = hasConnReqSlot ? 1 : 0;
              const connReqMsg = messages.find(m => m.step_number === 0) ?? null;
              return sequence.map((step, i) => {
              const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
              const Icon = meta.icon;
              const msg = messages.find(m => m.step_number === i + stepOffset) ?? null;
              const tmpl = messageTemplates[i] ?? null;
              // displayBody: prefer sent/tracked message, fall back to wizard template
              const displayBody: string | null = msg?.content ?? tmpl?.body ?? null;
              const displaySubject: string | null = msg ? null : (tmpl?.subject ?? null);
              const isSent = msg?.status === "sent";
              const isPending = msg?.status === "draft";
              const isPast = i < currentStep;
              const isCurrent = i === currentStep;
              const isOpen = expandedStep === i;
              const isEditing = editingIdx === i;
              // Show connection note inside first LinkedIn step (with its skipped/sent status)
              const showConnNote = i === 0 && step.channel === "linkedin" && (!!connectionNote || !!connReqMsg);

              return (
                <div key={i} style={{ borderBottom: i < sequence.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <button onClick={() => setExpandedStep(isOpen ? null : i)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: isPast ? meta.color : isCurrent ? gold : "#E5E7EB" }}>
                      {isPast ? <Check size={12} color="#fff" /> : isCurrent ? <PlayCircle size={12} color="#fff" /> : <span className="text-[10px] font-bold text-white">{i + 1}</span>}
                    </div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${meta.color}12`, color: meta.color }}><Icon size={11} /> {meta.label}</span>
                    <span className="text-xs" style={{ color: C.textDim }}>Day {dayPerStep[i] ?? 0}{i > 0 ? ` (+${step.daysAfter}d)` : ""}</span>
                    {showConnNote && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#0A66C212", color: "#0A66C2" }}>+ connection note</span>}
                    <div className="flex-1" />
                    {isSent && <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: C.greenLight, color: C.green }}><Send size={10} /> Sent</span>}
                    {isPending && <span className="text-xs px-2 py-0.5 rounded-md" style={{ backgroundColor: isCurrent ? `color-mix(in srgb, ${gold} 8%, transparent)` : "#F3F4F6", color: isCurrent ? gold : C.textMuted }}>{isCurrent ? "Up Next" : "Pending"}</span>}
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4 pt-1 fade-in space-y-3">
                      {/* Connection request note — only in first LinkedIn step */}
                      {showConnNote && (
                        <div className="rounded-lg border p-4" style={{ borderColor: "#0A66C220", backgroundColor: "#0A66C206" }}>
                          <div className="flex items-center gap-2 mb-2">
                            <Share2 size={12} style={{ color: "#0A66C2" }} />
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#0A66C2" }}>LinkedIn — Connection Request Note</span>
                            {connReqMsg?.status === "skipped" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>Skipped — already connected</span>
                            )}
                            {connReqMsg?.status === "sent" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: C.greenLight, color: C.green }}>Sent</span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{connectionNote || connReqMsg?.content}</p>
                        </div>
                      )}
                      {/* Step message */}
                      {displayBody && !isEditing && (
                        <div className="rounded-lg border p-4 relative" style={{ borderColor: isSent ? `${C.green}30` : isCurrent ? `color-mix(in srgb, ${gold} 19%, transparent)` : C.border, backgroundColor: isSent ? `${C.green}04` : isCurrent ? `color-mix(in srgb, ${gold} 2%, transparent)` : C.bg }}>
                          {displaySubject && (
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Subject: {displaySubject}</p>
                          )}
                          {!msg && tmpl && (
                            <p className="text-[10px] font-medium mb-2 px-2 py-0.5 rounded inline-block" style={{ backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)`, color: gold }}>Template — not yet sent</p>
                          )}
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{displayBody}</p>
                          {(isPending || (!msg && tmpl)) && isEditable && msg && (
                            <button onClick={() => { setEditingIdx(i); setEditContent(msg.content ?? ""); }}
                              className="absolute top-3 right-3 flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:opacity-80"
                              style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                              <Pencil size={10} /> Edit
                            </button>
                          )}
                        </div>
                      )}
                      {isEditing && msg && (
                        <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: gold, backgroundColor: `color-mix(in srgb, ${gold} 2%, transparent)` }}>
                          <textarea rows={5} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none" style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }} value={editContent} onChange={e => setEditContent(e.target.value)} />
                          <div className="flex gap-2">
                            <button onClick={() => saveMsg(msg.id)} disabled={saving} className="flex items-center gap-1 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.green, color: "#fff" }}>{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save</button>
                            <button onClick={() => setEditingIdx(null)} className="flex items-center gap-1 rounded-lg px-4 py-2 text-xs" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}><X size={12} /> Cancel</button>
                          </div>
                        </div>
                      )}
                      {!displayBody && !showConnNote && (
                        <div className="rounded-lg border border-dashed p-4 text-center" style={{ borderColor: C.border }}>
                          <p className="text-xs" style={{ color: C.textDim }}>No message for this step</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            });
          })()}
          </div>

          {/* Auto-replies */}
          {(autoReplies.positive || autoReplies.negative || autoReplies.question) && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Auto-Reply Templates</p>
              <div className="space-y-3">
                {autoReplies.positive && (
                  <div className="rounded-lg border p-3" style={{ borderColor: `${C.green}30`, backgroundColor: `${C.green}04` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.green }}>Positive Reply</p>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.positive}</p>
                  </div>
                )}
                {autoReplies.negative && (
                  <div className="rounded-lg border p-3" style={{ borderColor: `${C.red}30`, backgroundColor: `${C.red}04` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.red }}>Negative Reply</p>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.negative}</p>
                  </div>
                )}
                {autoReplies.question && (
                  <div className="rounded-lg border p-3" style={{ borderColor: `${C.blue}30`, backgroundColor: `${C.blue}04` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.blue }}>Question Reply</p>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.question}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB 2: CALLS ═══ */}
      {tab === 2 && (
        <CampaignCallsTab leads={allCampaigns.map(c => c.leads).filter(Boolean)} />
      )}

      {/* ═══ TAB 3: ADD LEADS ═══ */}
      {tab === 3 && (() => {
        const sameIcpLeads = campaignIcpId
          ? leadGroups.flatMap((g: LeadGroup) => g.leads.filter((l: UnlinkedLead) => (l as any).icp_profile_id === campaignIcpId))
          : [];
        const otherLeads = campaignIcpId
          ? leadGroups.flatMap((g: LeadGroup) => g.leads.filter((l: UnlinkedLead) => (l as any).icp_profile_id !== campaignIcpId))
          : leadGroups.flatMap((g: LeadGroup) => g.leads);
        const totalAvailable = leadGroups.reduce((s: number, g: LeadGroup) => s + g.leads.length, 0);

        const sameIcpProfileName = (() => {
          if (!campaignIcpId) return "Same Mining Ticket";
          const found = leadGroups.find((g: LeadGroup) => g.leads.some((l: UnlinkedLead) => (l as any).icp_profile_id === campaignIcpId));
          return found?.profileName ?? "Same Mining Ticket";
        })();

        const sameCompatCount = sameIcpLeads.filter((l: UnlinkedLead) => channels.every(ch => ch === "linkedin" ? l.allow_linkedin : ch === "email" ? l.allow_email : ch === "call" ? l.allow_call : true)).length;
        const otherCompatCount = otherLeads.filter((l: UnlinkedLead) => channels.every(ch => ch === "linkedin" ? l.allow_linkedin : ch === "email" ? l.allow_email : ch === "call" ? l.allow_call : true)).length;

        function renderLeadRow(lead: UnlinkedLead, showTicketName?: string) {
          const nm = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
          const ok = channels.every(ch => ch === "linkedin" ? lead.allow_linkedin : ch === "email" ? lead.allow_email : ch === "call" ? lead.allow_call : true);
          const isChecked = addSelected.has(lead.id);
          return (
            <div key={lead.id} className="flex items-center gap-4 px-5 py-2.5 cursor-pointer hover:bg-gray-50"
              style={{ opacity: ok ? 1 : 0.5, backgroundColor: isChecked ? `color-mix(in srgb, ${gold} 2%, transparent)` : "transparent" }}
              onClick={() => { if (ok) { const n = new Set(addSelected); isChecked ? n.delete(lead.id) : n.add(lead.id); setAddSelected(n); } }}>
              {ok && <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: gold }} />}
              <div className="flex-1 min-w-0">
                <Link href={`/leads/${lead.id}`} onClick={e => e.stopPropagation()}
                  className="text-sm font-medium hover:underline" style={{ color: C.textPrimary }}>{nm}</Link>
                <p className="text-xs" style={{ color: C.textMuted }}>
                  {lead.primary_title_role ?? ""}{lead.company_name ? ` · ${lead.company_name}` : ""}
                  {showTicketName && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>{showTicketName}</span>}
                </p>
              </div>
              {lead.lead_score != null && (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: lead.lead_score >= 80 ? C.redLight : lead.lead_score >= 50 ? C.orangeLight : C.accentLight, color: lead.lead_score >= 80 ? C.red : lead.lead_score >= 50 ? C.orange : C.accent }}>{lead.lead_score}</span>
              )}
              {ok ? (
                <button onClick={(e) => { e.stopPropagation(); addLeadsToCampaign([lead.id]); }} disabled={adding}
                  className="text-xs font-medium px-2 py-1 rounded-md disabled:opacity-50 hover:opacity-80" style={{ backgroundColor: `${C.green}12`, color: C.green }}>+ Add</button>
              ) : (
                <span className="text-xs" style={{ color: C.textDim }}>Missing channel</span>
              )}
            </div>
          );
        }

        return (
          <div>
            {/* Loading / selection bar */}
            {adding && (
              <div className="rounded-lg border px-4 py-3 mb-4 flex items-center gap-2" style={{ borderColor: gold, backgroundColor: `color-mix(in srgb, ${gold} 3%, transparent)` }}>
                <Loader2 size={14} className="animate-spin" style={{ color: gold }} />
                <span className="text-sm font-medium" style={{ color: gold }}>Adding leads to campaign...</span>
              </div>
            )}
            {addSelected.size > 0 && (
              <div className="flex items-center gap-2 mb-4 rounded-lg border px-4 py-3" style={{ borderColor: gold, backgroundColor: `color-mix(in srgb, ${gold} 2%, transparent)` }}>
                <span className="text-xs font-bold" style={{ color: gold }}>{addSelected.size} selected</span>
                <button onClick={() => addLeadsToCampaign(Array.from(addSelected))} disabled={adding}
                  className="flex items-center gap-1 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: C.green, color: "#fff" }}>
                  <UserPlus size={11} /> Add Selected to Campaign
                </button>
                <button onClick={() => setAddSelected(new Set())} className="text-xs underline" style={{ color: C.textMuted }}>Clear</button>
              </div>
            )}

            {totalAvailable === 0 ? (
              <div className="rounded-xl border py-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <p className="text-sm" style={{ color: C.textDim }}>All leads already have active campaigns</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 items-start">

                {/* ── CARD 1: Same Mining Ticket ── */}
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: `${C.green}40` }}>
                  {/* Card header */}
                  <div className="px-5 py-4 border-b" style={{ borderColor: `${C.green}20`, background: `linear-gradient(135deg, ${C.green}08 0%, ${C.green}04 100%)` }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Target size={14} style={{ color: C.green }} />
                        <span className="text-sm font-bold" style={{ color: C.green }}>Same Mining Ticket</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${C.green}15`, color: C.green }}>{sameIcpLeads.length}</span>
                    </div>
                    <p className="text-xs truncate" style={{ color: C.textMuted }}>{sameIcpProfileName}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs" style={{ color: C.textDim }}>{sameCompatCount} compatible with this flow</span>
                      <button
                        onClick={() => addLeadsToCampaign(sameIcpLeads.filter((l: UnlinkedLead) => channels.every(ch => ch === "linkedin" ? l.allow_linkedin : ch === "email" ? l.allow_email : ch === "call" ? l.allow_call : true)).map((l: UnlinkedLead) => l.id))}
                        disabled={adding || sameCompatCount === 0}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 hover:opacity-80"
                        style={{ backgroundColor: C.green, color: "#fff" }}>
                        <UserPlus size={11} /> Add All ({sameCompatCount})
                      </button>
                    </div>
                  </div>
                  {/* Lead rows */}
                  <div className="divide-y max-h-[420px] overflow-y-auto" style={{ borderColor: C.border }}>
                    {sameIcpLeads.length === 0 ? (
                      <div className="py-10 text-center">
                        <p className="text-xs" style={{ color: C.textDim }}>No leads from this mining ticket</p>
                      </div>
                    ) : sameIcpLeads.map((l: UnlinkedLead) => renderLeadRow(l))}
                  </div>
                </div>

                {/* ── CARD 2: Other Available Leads ── */}
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {/* Card header */}
                  <div className="px-5 py-4 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Users size={14} style={{ color: C.textMuted }} />
                        <span className="text-sm font-bold" style={{ color: C.textBody }}>Other Available Leads</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>{otherLeads.length}</span>
                    </div>
                    <p className="text-xs" style={{ color: C.textDim }}>From different mining tickets</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs" style={{ color: C.textDim }}>{otherCompatCount} compatible with this flow</span>
                      <button
                        onClick={() => addLeadsToCampaign(otherLeads.filter((l: UnlinkedLead) => channels.every(ch => ch === "linkedin" ? l.allow_linkedin : ch === "email" ? l.allow_email : ch === "call" ? l.allow_call : true)).map((l: UnlinkedLead) => l.id))}
                        disabled={adding || otherCompatCount === 0}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 hover:opacity-80"
                        style={{ backgroundColor: C.textBody, color: "#fff" }}>
                        <UserPlus size={11} /> Add All ({otherCompatCount})
                      </button>
                    </div>
                  </div>
                  {/* Lead rows with ticket name badge */}
                  <div className="divide-y max-h-[420px] overflow-y-auto" style={{ borderColor: C.border }}>
                    {otherLeads.length === 0 ? (
                      <div className="py-10 text-center">
                        <p className="text-xs" style={{ color: C.textDim }}>No other leads available</p>
                      </div>
                    ) : otherLeads.map((l: UnlinkedLead) => {
                      const ticketName = leadGroups.find((g: LeadGroup) => g.leads.some((gl: UnlinkedLead) => gl.id === l.id))?.profileName;
                      return renderLeadRow(l, ticketName);
                    })}
                  </div>
                </div>

              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
