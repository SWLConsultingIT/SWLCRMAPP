"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { Users, Share2, Phone, Mail, Loader2, CheckCircle } from "lucide-react";
import TenantTeamTab from "../TenantTeamTab";

const gold = "var(--brand, #c9a83a)";

type Props = { companyBioId: string; companyName: string };

type SellerRow = { id: string; name: string; active: boolean; company_bio_id: string | null; linkedin_status: string | null; linkedin_status_note: string | null };
type AircallNumber = { id: number; name: string; digits: string; country: string };
type InstantlyEmail = { email: string; dailyLimit: number; warmupScore: number; setupPending: boolean };

const linkedinStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  active:     { label: "Active",     color: "#16A34A", bg: "#DCFCE7" },
  restricted: { label: "Restricted", color: "#D97706", bg: "#FFFBEB" },
  banned:     { label: "Banned",     color: "#DC2626", bg: "#FEE2E2" },
  warning:    { label: "Warning",    color: "#7C3AED", bg: "#EDE9FE" },
};

export default function ClientResourcesTabs({ companyBioId, companyName }: Props) {
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: "Users",    icon: Users,  color: C.blue },
    { label: "Sellers",  icon: Share2, color: "#7C3AED" },
    { label: "Aircall",  icon: Phone,  color: C.phone },
    { label: "Emails",   icon: Mail,   color: "#7C3AED" },
  ];

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
          Client Resources
        </p>
        <p className="text-xs mt-0.5" style={{ color: C.textDim }}>
          Manage what {companyName} has access to across channels.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b px-5" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              <Icon size={13} /> {t.label}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
      </div>

      <div className="p-5">
        {/* Use the same TenantTeamTab that owners see in /admin so super_admin
            gets the full Team management (invite + role + remove) when
            looking at any tenant — including SWL itself. The /api/team
            endpoints already accept ?bioId=… for super_admin cross-tenant. */}
        {tab === 0 && <TenantTeamTab companyBioId={companyBioId} canManage={true} />}
        {tab === 1 && <ClientSellers companyBioId={companyBioId} />}
        {tab === 2 && <ClientAircall companyBioId={companyBioId} />}
        {tab === 3 && <ClientEmails companyBioId={companyBioId} />}
      </div>
    </div>
  );
}

// Users tab now uses TenantTeamTab (the same component owners see in /admin
// for their own tenant). Provides invite + role management + remove. The
// legacy ClientUsers function was removed when this was wired up.

// ═══ SELLERS ════════════════════════════════════════════════════════════════
function ClientSellers({ companyBioId }: { companyBioId: string }) {
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/sellers")
      .then(r => r.json())
      .then(d => setSellers((d.sellers ?? []).filter((s: SellerRow) => s.company_bio_id === companyBioId)))
      .finally(() => setLoading(false));
  }, [companyBioId]);

  if (loading) return <Spinner />;

  if (sellers.length === 0) return (
    <EmptyState icon={Share2} text="No sellers assigned to this client" sub="Sellers with LinkedIn accounts appear here. Assign them from the global Sellers view." />
  );

  return (
    <div className="divide-y" style={{ borderColor: C.border }}>
      {sellers.map(seller => {
        const statusMeta = seller.linkedin_status ? linkedinStatusMeta[seller.linkedin_status] : null;
        return (
          <div key={seller.id} className="flex items-center gap-4 py-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: seller.active ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` : C.border, color: seller.active ? "#fff" : "#9CA3AF" }}>
              {seller.name[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{seller.name}</p>
              <p className="text-[11px]" style={{ color: C.textDim }}>
                {seller.active ? "Active seller" : "Inactive"}{seller.linkedin_status_note ? ` · ${seller.linkedin_status_note}` : ""}
              </p>
            </div>
            {statusMeta && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>
                {statusMeta.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══ AIRCALL ═══════════════════════════════════════════════════════════════
function ClientAircall({ companyBioId }: { companyBioId: string }) {
  const [numbers, setNumbers] = useState<AircallNumber[]>([]);
  const [assigned, setAssigned] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/aircall-access")
      .then(r => r.json())
      .then(d => {
        setNumbers(d.numbers ?? []);
        const me = (d.companies ?? []).find((c: any) => c.id === companyBioId);
        setAssigned(me?.aircall_number_ids ?? []);
      })
      .finally(() => setLoading(false));
  }, [companyBioId]);

  async function toggle(numberId: number) {
    const next = assigned.includes(numberId) ? assigned.filter(id => id !== numberId) : [...assigned, numberId];
    setAssigned(next);
    setSaving(true);
    await fetch("/api/admin/aircall-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyBioId, aircallNumberIds: next }),
    });
    setSaving(false);
  }

  const flags: Record<string, string> = { DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽", ES: "🇪🇸", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧" };

  if (loading) return <Spinner />;

  if (numbers.length === 0) return <EmptyState icon={Phone} text="No Aircall numbers available" />;

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: C.textMuted }}>
        {saving && <Loader2 size={11} className="inline animate-spin mr-1" />}
        Click to toggle access.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {numbers.map(n => {
          const isAssigned = assigned.includes(n.id);
          return (
            <button key={n.id} onClick={() => toggle(n.id)} disabled={saving}
              className="rounded-lg border p-3 flex items-center gap-3 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-60"
              style={{
                borderColor: isAssigned ? C.phone : C.border,
                backgroundColor: isAssigned ? `${C.phone}08` : C.bg,
                borderWidth: isAssigned ? 2 : 1,
              }}
            >
              <span className="text-xl shrink-0">{flags[n.country] ?? "📞"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{n.name || n.country}</p>
                <p className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>{n.digits}</p>
              </div>
              {isAssigned && <CheckCircle size={14} style={{ color: C.phone }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══ EMAILS ═════════════════════════════════════════════════════════════════
type WorkspaceSection = {
  workspaceId: string | null;
  label: string;
  isEnvFallback: boolean;
  inboxes: InstantlyEmail[];
  error: string | null;
};

function ClientEmails({ companyBioId }: { companyBioId: string }) {
  const [sections, setSections] = useState<WorkspaceSection[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/email-access").then(r => r.json());
      setSections(d.sections ?? []);
      const me = (d.companies ?? []).find((c: any) => c.id === companyBioId);
      setAssigned(me?.email_accounts ?? []);
      setCampaignId(me?.instantly_campaign_id ?? "");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [companyBioId]);

  // The tenant's workspace is set automatically the first time an inbox is
  // assigned: we infer it from the workspace section the inbox came from.
  // Picking inboxes from a different workspace later overwrites it (same
  // pattern as Aircall — admin picks resources, system tracks the source).
  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch("/api/admin/email-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyBioId, ...payload }),
      });
    } finally {
      setSaving(false);
    }
  }

  function workspaceForEmail(email: string): string | null {
    for (const s of sections) {
      if (s.inboxes.some(i => i.email === email)) return s.workspaceId;
    }
    return null;
  }

  async function toggle(email: string) {
    const isAssigned = assigned.includes(email);
    const next = isAssigned ? assigned.filter(e => e !== email) : [...assigned, email];
    setAssigned(next);
    const payload: Record<string, unknown> = { emailAccounts: next };
    // When assigning a new email, also align the tenant's workspace to its
    // source. When unassigning, leave the workspace alone (admin can change
    // it manually in the main /admin Email Access tab if they want).
    if (!isAssigned) {
      const ws = workspaceForEmail(email);
      if (ws) payload.instantlyWorkspaceId = ws;
    }
    await patch(payload);
  }

  async function saveCampaignId(v: string) {
    const trimmed = v.trim();
    setCampaignId(trimmed);
    await patch({ instantlyCampaignId: trimmed || null });
  }

  if (loading) return <Spinner />;

  const totalInboxes = sections.reduce((n, s) => n + s.inboxes.length, 0);
  if (totalInboxes === 0) return <EmptyState icon={Mail} text="No Instantly inboxes available" sub="Register a workspace from /admin → Email Access first." />;

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: C.textMuted }}>
        {saving && <Loader2 size={11} className="inline animate-spin mr-1" />}
        Click to toggle. The tenant&apos;s workspace is set automatically from the first assigned inbox.
      </p>

      {sections.map(section => {
        if (section.inboxes.length === 0) return null;
        const byDomain = section.inboxes.reduce<Record<string, InstantlyEmail[]>>((acc, e) => {
          const d = e.email.split("@")[1] ?? "other";
          (acc[d] ??= []).push(e);
          return acc;
        }, {});
        const sectionAssignedCount = section.inboxes.filter(e => assigned.includes(e.email)).length;

        return (
          <div key={section.workspaceId ?? "env"} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#7C3AED12", color: "#7C3AED" }}>
                {section.label}
              </span>
              <span className="text-[10px]" style={{ color: C.textDim }}>
                {sectionAssignedCount}/{section.inboxes.length} assigned
              </span>
              {section.error && <span className="text-[10px]" style={{ color: C.red }}>· {section.error}</span>}
            </div>

            {Object.entries(byDomain).sort((a, b) => a[0].localeCompare(b[0])).map(([domain, list]) => {
              const allAssigned = list.every(e => assigned.includes(e.email));
              const someAssigned = list.some(e => assigned.includes(e.email));
              return (
                <div key={`${section.workspaceId ?? "env"}-${domain}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-medium" style={{ color: C.textMuted }}>
                      {domain} <span style={{ color: C.textDim }}>({list.length})</span>
                    </p>
                    <button
                      onClick={() => {
                        const next = allAssigned
                          ? assigned.filter(e => !list.some(l => l.email === e))
                          : Array.from(new Set([...assigned, ...list.map(l => l.email)]));
                        setAssigned(next);
                        const payload: Record<string, unknown> = { emailAccounts: next };
                        if (!allAssigned && section.workspaceId) payload.instantlyWorkspaceId = section.workspaceId;
                        patch(payload);
                      }}
                      className="text-[10px] font-semibold"
                      style={{ color: allAssigned ? C.red : "#7C3AED" }}
                    >
                      {allAssigned ? "Unassign all" : someAssigned ? "Assign rest" : "Assign all"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {list.map(e => {
                      const isAssigned = assigned.includes(e.email);
                      return (
                        <button key={e.email} onClick={() => toggle(e.email)} disabled={saving}
                          className="rounded-lg border p-3 flex items-center gap-3 text-left hover:shadow-sm disabled:opacity-60"
                          style={{
                            borderColor: isAssigned ? "#7C3AED" : C.border,
                            backgroundColor: isAssigned ? "#7C3AED08" : C.bg,
                            borderWidth: isAssigned ? 2 : 1,
                          }}>
                          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: "#7C3AED15" }}>
                            <Mail size={11} style={{ color: "#7C3AED" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold truncate" style={{ color: C.textPrimary }}>{e.email}</p>
                            <p className="text-[10px]" style={{ color: C.textMuted }}>
                              {e.setupPending ? "Warming up" : `${e.dailyLimit}/d · score ${e.warmupScore}`}
                            </p>
                          </div>
                          {isAssigned && <CheckCircle size={13} style={{ color: "#7C3AED" }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Instantly campaign UUID — required for the dispatcher to send. */}
      <div className="pt-3 border-t" style={{ borderColor: C.border }}>
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
          Instantly campaign UUID
        </label>
        <input
          type="text"
          defaultValue={campaignId}
          onBlur={e => { if (e.target.value.trim() !== campaignId) saveCampaignId(e.target.value); }}
          placeholder="0193a8c5-… (UUID of the passthrough campaign in this tenant's Instantly workspace)"
          className="w-full text-xs font-mono px-3 py-2 rounded-lg border outline-none"
          style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
        />
        <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
          Required for outgoing email. The campaign must use{" "}
          <code>{"{{subject_line}}"}</code> as subject and <code>{"{{personalization}}"}</code> as body so the CRM&apos;s personalized content gets sent verbatim.
        </p>
      </div>
    </div>
  );
}

// ═══ Shared ═════════════════════════════════════════════════════════════════
function Spinner() {
  return <div className="flex items-center justify-center py-12"><Loader2 size={18} className="animate-spin" style={{ color: C.textDim }} /></div>;
}

function EmptyState({ icon: Icon, text, sub }: { icon: any; text: string; sub?: string }) {
  return (
    <div className="py-10 text-center">
      <Icon size={22} className="mx-auto mb-2" style={{ color: C.textDim }} />
      <p className="text-sm font-medium" style={{ color: C.textMuted }}>{text}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: C.textDim }}>{sub}</p>}
    </div>
  );
}
