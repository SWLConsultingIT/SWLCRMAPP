"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Building2, Users, Megaphone, Clock, ChevronRight,
  Target, Search, X, CheckCircle, ArrowRight, Shield,
  Trash2, Loader2, Share2, AlertTriangle, Phone, Mail,
  Activity, Theater, Zap, Plus, Edit3,
} from "lucide-react";
import AdminActions from "./AdminActions";
import PageHero from "@/components/PageHero";
import PendingUsersSection from "./PendingUsersSection";
import ActivityWidget from "@/components/ActivityWidget";
import TenantTeamTab from "./TenantTeamTab";

type UserRow = {
  id: string;
  email: string;
  role: string | null;
  company_bio_id: string | null;
  company_name: string | null;
  created_at: string;
};

type Company = { id: string; company_name: string };

const gold = "var(--brand, #c9a83a)";

type ClientData = {
  id: string;
  company_name: string;
  industry: string | null;
  location: string | null;
  logo_url: string | null;
  leads: number;
  profiles: number;
  campaigns: number;
  pendingProfiles: number;
  pendingCampaigns: number;
};

type PendingApproval = {
  id: string;
  type: "profile" | "campaign";
  name: string;
  clientName: string;
  clientId: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

type Props = {
  clients: ClientData[];
  pendingApprovals: PendingApproval[];
  executionItems?: unknown[];
  stats: {
    totalClients: number;
    totalLeads: number;
    pendingApprovals: number;
    activeCampaigns: number;
    executionPending?: number;
  };
  /** Caller's own bio_id (super_admin → SWL). Used by the "My Team" tab to
   *  scope TenantTeamTab to the admin's own workspace without forcing them
   *  to click into "SWL Consulting" as if it were just another client. */
  myCompanyBioId: string | null;
};

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(d => { setUsers(d.users ?? []); setCompanies(d.companies ?? []); })
      .finally(() => setLoading(false));
  }, []);

  async function update(userId: string, patch: { role?: string; company_bio_id?: string | null }) {
    setSaving(userId);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...patch, company_name: patch.company_bio_id ? (companies.find(c => c.id === patch.company_bio_id)?.company_name ?? null) : null } : u));
    setSaving(null);
  }

  async function remove(userId: string) {
    setSaving(userId);
    await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: null, company_bio_id: null, company_name: null } : u));
    setSaving(null);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={20} className="animate-spin" style={{ color: C.textDim }} />
    </div>
  );

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {users.length === 0 && (
        <div className="py-16 text-center">
          <Users size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm" style={{ color: C.textMuted }}>No users found</p>
        </div>
      )}
      {users.map((user, i) => (
        <div
          key={user.id}
          className="flex items-center gap-4 px-5 py-4"
          style={{ borderBottom: i < users.length - 1 ? `1px solid ${C.border}` : "none" }}
        >
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}
          >
            {user.email[0]?.toUpperCase() ?? "?"}
          </div>

          {/* Email */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{user.email}</p>
              {user.role && !user.company_bio_id && (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                  style={{ backgroundColor: "#FEF3C7", color: "#D97706" }}>
                  <AlertTriangle size={9} /> No company
                </span>
              )}
            </div>
            <p className="text-[11px]" style={{ color: C.textDim }}>
              {user.role ? `${user.role} · joined ${new Date(user.created_at).toLocaleDateString()}` : "No profile assigned"}
            </p>
          </div>

          {/* Role selector */}
          <select
            value={user.role ?? ""}
            disabled={saving === user.id}
            onChange={e => update(user.id, { role: e.target.value })}
            className="text-xs rounded-lg border px-2.5 py-1.5 outline-none"
            style={{
              borderColor: C.border,
              color: user.role === "admin" ? gold : C.textBody,
              backgroundColor: user.role === "admin" ? `color-mix(in srgb, ${gold} 7%, transparent)` : C.card,
            }}
          >
            <option value="">— no role —</option>
            <option value="admin">admin</option>
            <option value="client">client</option>
          </select>

          {/* Company selector */}
          <select
            value={user.company_bio_id ?? ""}
            disabled={saving === user.id}
            onChange={e => update(user.id, { company_bio_id: e.target.value || null })}
            className="text-xs rounded-lg border px-2.5 py-1.5 outline-none max-w-[180px]"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
          >
            <option value="">— no company —</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>

          {/* Save spinner / remove */}
          {saving === user.id ? (
            <Loader2 size={14} className="animate-spin shrink-0" style={{ color: C.textDim }} />
          ) : (
            <button
              onClick={() => remove(user.id)}
              title="Remove profile"
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors shrink-0"
            >
              <Trash2 size={13} style={{ color: C.textDim }} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type SellerRow = {
  id: string;
  name: string;
  active: boolean;
  company_bio_id: string | null;
  company_name: string | null;
  linkedin_status: string | null;
  linkedin_status_note: string | null;
};

const linkedinStatusMeta: Record<string, { label: string; color: string; bg: string }> = {
  active:     { label: "Active",     color: "#16A34A", bg: "#DCFCE7" },
  restricted: { label: "Restricted", color: "#D97706", bg: "#FFFBEB" },
  banned:     { label: "Banned",     color: "#DC2626", bg: "#FEE2E2" },
  warning:    { label: "Warning",    color: "#7C3AED", bg: "#EDE9FE" },
};

function SellersTab() {
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/sellers")
      .then(r => r.json())
      .then(d => { setSellers(d.sellers ?? []); setCompanies(d.companies ?? []); })
      .finally(() => setLoading(false));
  }, []);

  async function update(sellerId: string, company_bio_id: string | null) {
    setSaving(sellerId);
    await fetch(`/api/admin/sellers/${sellerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_bio_id }),
    });
    setSellers(prev => prev.map(s => s.id === sellerId
      ? { ...s, company_bio_id, company_name: company_bio_id ? (companies.find(c => c.id === company_bio_id)?.company_name ?? null) : null }
      : s
    ));
    setSaving(null);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={20} className="animate-spin" style={{ color: C.textDim }} />
    </div>
  );

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {sellers.length === 0 && (
        <div className="py-16 text-center">
          <Share2 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm" style={{ color: C.textMuted }}>No sellers found</p>
        </div>
      )}
      {sellers.map((seller, i) => {
        const statusMeta = seller.linkedin_status ? linkedinStatusMeta[seller.linkedin_status] : null;
        return (
          <div
            key={seller.id}
            className="flex items-center gap-4 px-5 py-4"
            style={{ borderBottom: i < sellers.length - 1 ? `1px solid ${C.border}` : "none" }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: seller.active ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` : C.border, color: seller.active ? "#fff" : "#9CA3AF" }}
            >
              {seller.name[0]?.toUpperCase() ?? "?"}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{seller.name}</p>
              <p className="text-[11px]" style={{ color: C.textDim }}>
                {seller.active ? "Active seller" : "Inactive"}{seller.linkedin_status_note ? ` · ${seller.linkedin_status_note}` : ""}
              </p>
            </div>

            {statusMeta && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0"
                style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>
                {statusMeta.label}
              </span>
            )}

            <select
              value={seller.company_bio_id ?? ""}
              disabled={saving === seller.id}
              onChange={e => update(seller.id, e.target.value || null)}
              className="text-xs rounded-lg border px-2.5 py-1.5 outline-none max-w-[200px]"
              style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
            >
              <option value="">— no company —</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>

            {saving === seller.id && (
              <Loader2 size={14} className="animate-spin shrink-0" style={{ color: C.textDim }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

type AircallNumber = { id: number; name: string; digits: string; country: string };
type CompanyWithNumbers = { id: string; company_name: string; aircall_number_ids: number[] | null };

function AircallAccessTab() {
  const [numbers, setNumbers] = useState<AircallNumber[]>([]);
  const [companies, setCompanies] = useState<CompanyWithNumbers[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/aircall-access")
      .then(r => r.json())
      .then(d => { setNumbers(d.numbers ?? []); setCompanies(d.companies ?? []); })
      .finally(() => setLoading(false));
  }, []);

  async function toggleNumber(companyId: string, numberId: number) {
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    const current = company.aircall_number_ids ?? [];
    const next = current.includes(numberId)
      ? current.filter(id => id !== numberId)
      : [...current, numberId];

    setSaving(companyId);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, aircall_number_ids: next } : c));
    try {
      await fetch("/api/admin/aircall-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyBioId: companyId, aircallNumberIds: next }),
      });
    } finally {
      setSaving(null);
    }
  }

  const flags: Record<string, string> = { DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽", ES: "🇪🇸", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧" };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={20} className="animate-spin" style={{ color: C.textDim }} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textMuted }}>
          <span className="font-semibold" style={{ color: C.textBody }}>Click a client</span> to assign which Aircall numbers they can use in their campaigns. If no numbers are selected, the client won&apos;t see any in the campaign creation flow (admins still see all).
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        {companies.map((company, i) => {
          const assigned = company.aircall_number_ids ?? [];
          const isExpanded = expandedId === company.id;
          return (
            <div key={company.id} style={{ borderBottom: i < companies.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : company.id)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-black/[0.015] text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${C.phone}15` }}>
                  <Phone size={15} style={{ color: C.phone }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{company.company_name}</p>
                  <p className="text-[11px]" style={{ color: C.textDim }}>
                    {assigned.length === 0 ? "No numbers assigned" : `${assigned.length} number${assigned.length > 1 ? "s" : ""} assigned`}
                  </p>
                </div>
                {saving === company.id && <Loader2 size={14} className="animate-spin" style={{ color: C.textDim }} />}
                <ChevronRight size={14} style={{
                  color: C.textDim,
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }} />
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 pt-1">
                  {numbers.length === 0 ? (
                    <p className="text-xs italic" style={{ color: C.textDim }}>No Aircall numbers available.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {numbers.map(n => {
                        const isAssigned = assigned.includes(n.id);
                        return (
                          <button
                            key={n.id}
                            onClick={() => toggleNumber(company.id, n.id)}
                            disabled={saving === company.id}
                            className="rounded-lg border p-3 flex items-center gap-3 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-60"
                            style={{
                              borderColor: isAssigned ? C.phone : C.border,
                              backgroundColor: isAssigned ? `${C.phone}08` : C.bg,
                              borderWidth: isAssigned ? 2 : 1,
                            }}
                          >
                            <span className="text-xl shrink-0">{flags[n.country] ?? "📞"}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>
                                {n.name || n.country}
                              </p>
                              <p className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>{n.digits}</p>
                            </div>
                            {isAssigned && <CheckCircle size={14} style={{ color: C.phone }} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {companies.length === 0 && (
          <div className="py-16 text-center">
            <Phone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm" style={{ color: C.textMuted }}>No companies found</p>
          </div>
        )}
      </div>
    </div>
  );
}

type InstantlyEmail = { email: string; dailyLimit: number; warmupScore: number; setupPending: boolean };
type WorkspaceSection = {
  workspaceId: string | null;
  label: string;
  accountUserId: string | null;
  notes: string | null;
  isEnvFallback: boolean;
  inboxes: InstantlyEmail[];
  error: string | null;
};
type CompanyWithEmails = {
  id: string;
  company_name: string;
  email_accounts: string[];
  instantly_workspace_id: string | null;
  instantly_campaign_id: string | null;
};
type WorkspaceRow = { id: string; label: string; account_user_id: string | null; notes: string | null };

function EmailAccessTab() {
  const [sections, setSections] = useState<WorkspaceSection[]>([]);
  const [companies, setCompanies] = useState<CompanyWithEmails[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [accessRes, wsRes] = await Promise.all([
        fetch("/api/admin/email-access").then(r => r.json()),
        fetch("/api/admin/instantly/workspaces").then(r => r.json()),
      ]);
      setSections(accessRes.sections ?? []);
      setCompanies(accessRes.companies ?? []);
      setWorkspaces(wsRes.workspaces ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  // Flatten all inboxes across workspaces, with the workspace each one
  // belongs to so the assignment UI can show the source.
  const allInboxes = sections.flatMap(s => s.inboxes.map(i => ({ ...i, workspaceLabel: s.label, workspaceId: s.workspaceId })));

  async function patchCompany(id: string, payload: Record<string, unknown>) {
    setSaving(id);
    try {
      await fetch("/api/admin/email-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyBioId: id, ...payload }),
      });
    } finally {
      setSaving(null);
    }
  }

  async function toggleEmail(companyId: string, email: string) {
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    const current = company.email_accounts ?? [];
    const next = current.includes(email) ? current.filter(e => e !== email) : [...current, email];
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, email_accounts: next } : c));
    await patchCompany(companyId, { emailAccounts: next });
  }

  async function setWorkspaceForCompany(companyId: string, workspaceId: string | null) {
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, instantly_workspace_id: workspaceId } : c));
    await patchCompany(companyId, { instantlyWorkspaceId: workspaceId });
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={20} className="animate-spin" style={{ color: C.textDim }} />
    </div>
  );

  const totalInboxes = allInboxes.length;

  return (
    <div className="space-y-4">
      {/* Workspaces management section */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textBody }}>Instantly workspaces</p>
            <p className="text-[11px]" style={{ color: C.textDim }}>
              {sections.length} {sections.length === 1 ? "workspace" : "workspaces"} · {totalInboxes} {totalInboxes === 1 ? "inbox" : "inboxes"} total
            </p>
          </div>
          <button
            onClick={() => setShowAddWorkspace(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "#7C3AED12", color: "#7C3AED" }}
          >
            <Plus size={11} /> Add workspace
          </button>
        </div>
        <div>
          {sections.length === 0 ? (
            <p className="text-xs italic px-5 py-6" style={{ color: C.textDim }}>
              No workspaces registered. Add one to start listing inboxes.
            </p>
          ) : sections.map((s, i) => (
            <WorkspaceRow
              key={s.workspaceId ?? "env"}
              section={s}
              isLast={i === sections.length - 1}
              onChanged={reload}
            />
          ))}
        </div>
      </div>

      {/* Tenant assignments */}
      <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textBody }}>
          <span className="font-semibold">{totalInboxes} inboxes available across {sections.length} workspaces.</span>
          <span style={{ color: C.textMuted }}> Assign each tenant which inboxes they can use + the Instantly workspace the dispatcher routes through. Sync Approved Campaigns creates one Instantly campaign per approved request automatically — no manual campaign UUID needed.</span>
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        {companies.map((company, i) => {
          const assigned = company.email_accounts ?? [];
          const isExpanded = expandedId === company.id;
          const tenantWs = workspaces.find(w => w.id === company.instantly_workspace_id);
          return (
            <div key={company.id} style={{ borderBottom: i < companies.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : company.id)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-black/[0.015] text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#7C3AED15" }}>
                  <Mail size={15} style={{ color: "#7C3AED" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{company.company_name}</p>
                  <p className="text-[11px]" style={{ color: C.textDim }}>
                    {assigned.length === 0 ? "No inboxes assigned" : `${assigned.length} inbox${assigned.length > 1 ? "es" : ""}`}
                    {tenantWs && <span> · {tenantWs.label}</span>}
                  </p>
                </div>
                {saving === company.id && <Loader2 size={14} className="animate-spin" style={{ color: C.textDim }} />}
                <ChevronRight size={14} style={{
                  color: C.textDim,
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }} />
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 pt-1 space-y-4">
                  {/* Workspace selector */}
                  <div className="p-3 rounded-lg" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                    <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Instantly workspace</label>
                    <select
                      value={company.instantly_workspace_id ?? ""}
                      onChange={e => setWorkspaceForCompany(company.id, e.target.value || null)}
                      disabled={saving === company.id}
                      className="w-full text-xs px-2.5 py-1.5 rounded border outline-none"
                      style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                    >
                      <option value="">— Use env fallback —</option>
                      {workspaces.map(w => (
                        <option key={w.id} value={w.id}>{w.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Inbox grid grouped by workspace + domain */}
                  {sections.length === 0 ? (
                    <p className="text-xs italic" style={{ color: C.textDim }}>No workspaces registered.</p>
                  ) : sections.map(section => {
                    const sectionInboxes = section.inboxes;
                    if (sectionInboxes.length === 0) return null;
                    const byDomain = sectionInboxes.reduce<Record<string, InstantlyEmail[]>>((acc, e) => {
                      const dom = e.email.split("@")[1] ?? "other";
                      (acc[dom] ??= []).push(e);
                      return acc;
                    }, {});
                    const sectionAssignedCount = sectionInboxes.filter(e => assigned.includes(e.email)).length;
                    return (
                      <div key={section.workspaceId ?? "env"} className="space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: "#7C3AED12", color: "#7C3AED" }}>
                            {section.label}
                          </span>
                          <span className="text-[10px]" style={{ color: C.textDim }}>
                            {sectionAssignedCount}/{sectionInboxes.length} assigned
                          </span>
                          {section.error && (
                            <span className="text-[10px]" style={{ color: C.red }}>· {section.error}</span>
                          )}
                        </div>
                        {Object.entries(byDomain).sort((a, b) => a[0].localeCompare(b[0])).map(([domain, list]) => {
                          const allAssignedInDomain = list.every(e => assigned.includes(e.email));
                          const someAssignedInDomain = list.some(e => assigned.includes(e.email));
                          return (
                            <div key={`${section.workspaceId ?? "env"}-${domain}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[10px] font-medium" style={{ color: C.textMuted }}>
                                  {domain} <span style={{ color: C.textDim }}>({list.length})</span>
                                </p>
                                <button
                                  onClick={() => {
                                    const next = allAssignedInDomain
                                      ? assigned.filter(e => !list.some(l => l.email === e))
                                      : Array.from(new Set([...assigned, ...list.map(l => l.email)]));
                                    setCompanies(prev => prev.map(c => c.id === company.id ? { ...c, email_accounts: next } : c));
                                    patchCompany(company.id, { emailAccounts: next });
                                  }}
                                  className="text-[10px] font-semibold"
                                  style={{ color: allAssignedInDomain ? C.red : "#7C3AED" }}
                                >
                                  {allAssignedInDomain ? "Unassign all" : someAssignedInDomain ? "Assign rest" : "Assign all"}
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {list.map(e => {
                                  const isAssigned = assigned.includes(e.email);
                                  return (
                                    <button
                                      key={e.email}
                                      onClick={() => toggleEmail(company.id, e.email)}
                                      disabled={saving === company.id}
                                      className="rounded-lg border p-3 flex items-center gap-3 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm disabled:opacity-60"
                                      style={{
                                        borderColor: isAssigned ? "#7C3AED" : C.border,
                                        backgroundColor: isAssigned ? "#7C3AED08" : C.bg,
                                        borderWidth: isAssigned ? 2 : 1,
                                      }}
                                    >
                                      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "#7C3AED15" }}>
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddWorkspace && <AddWorkspaceModal onClose={() => setShowAddWorkspace(false)} onCreated={() => { setShowAddWorkspace(false); reload(); }} />}
    </div>
  );
}

function WorkspaceRow({ section, isLast, onChanged }: { section: WorkspaceSection; isLast: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="px-5 py-3" style={{ borderBottom: isLast ? "none" : `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{section.label}</span>
            {section.isEnvFallback && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                style={{ backgroundColor: C.surface, color: C.textMuted }}>env</span>
            )}
            {section.error && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                style={{ backgroundColor: `${C.red}15`, color: C.red }}>error</span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: C.textDim }}>
            {section.inboxes.length} inboxes
            {section.accountUserId && <span> · account {section.accountUserId.slice(0, 8)}…</span>}
            {section.error && <span style={{ color: C.red }}> · {section.error}</span>}
          </p>
          {section.notes && <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{section.notes}</p>}
        </div>
        {!section.isEnvFallback && section.workspaceId && (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] font-semibold inline-flex items-center gap-1"
            style={{ color: C.textMuted }}
          >
            <Edit3 size={10} /> Edit
          </button>
        )}
      </div>
      {editing && section.workspaceId && (
        <EditWorkspaceModal
          id={section.workspaceId}
          initialLabel={section.label}
          initialNotes={section.notes ?? ""}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/admin/instantly/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, apiKey, notes: notes || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Failed"); return; }
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Add Instantly workspace</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SWL Main, Pathway, Hypergrowth Arqy"
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>API key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" placeholder="Bearer token from Instantly settings"
              className="w-full text-sm font-mono px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. billed to fran@swl, inbox pool 50/d"
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          {err && <p className="text-xs" style={{ color: C.red }}>{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody }}>Cancel</button>
          <button onClick={save} disabled={saving || !label.trim() || !apiKey.trim()} className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5" style={{ backgroundColor: "#7C3AED", color: "white" }}>
            {saving && <Loader2 size={11} className="animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}

function EditWorkspaceModal({ id, initialLabel, initialNotes, onClose, onSaved }: { id: string; initialLabel: string; initialNotes: string; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initialLabel);
  const [apiKey, setApiKey] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/instantly/workspaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, notes, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Failed"); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/instantly/workspaces/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Delete failed"); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold mb-4" style={{ color: C.textPrimary }}>Edit workspace</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>New API key (leave empty to keep current)</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off"
              className="w-full text-sm font-mono px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          </div>
          {err && <p className="text-xs" style={{ color: C.red }}>{err}</p>}
        </div>
        <div className="flex items-center justify-between mt-5">
          {!confirmingDelete ? (
            <button onClick={() => setConfirmingDelete(true)} disabled={saving} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: C.red }}>
              <Trash2 size={11} /> Delete
            </button>
          ) : (
            <div className="inline-flex items-center gap-2">
              <span className="text-[10px]" style={{ color: C.textBody }}>Tenants using this revert to env.</span>
              <button onClick={destroy} disabled={saving} className="text-[10px] font-semibold px-2 py-1 rounded" style={{ backgroundColor: C.red, color: "white" }}>Confirm delete</button>
              <button onClick={() => setConfirmingDelete(false)} disabled={saving} className="text-[10px] font-medium px-2 py-1 rounded" style={{ backgroundColor: C.surface, color: C.textBody }}>Cancel</button>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody }}>Close</button>
            <button onClick={save} disabled={saving || !label.trim()} className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5" style={{ backgroundColor: "#7C3AED", color: "white" }}>
              {saving && <Loader2 size={11} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminClient({ clients, pendingApprovals, stats, myCompanyBioId }: Props) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");

  const filteredClients = !search
    ? clients
    : clients.filter(c =>
        `${c.company_name} ${c.industry} ${c.location}`.toLowerCase().includes(search.toLowerCase())
      );

  const filteredApprovals = !search
    ? pendingApprovals
    : pendingApprovals.filter(a =>
        `${a.name} ${a.clientName} ${a.subtitle}`.toLowerCase().includes(search.toLowerCase())
      );

  const tabs = [
    { label: "Clients",           count: clients.length,          color: gold,      icon: Building2 },
    { label: "Pending Approvals", count: pendingApprovals.length, color: "#D97706", icon: Clock },
    { label: "Activity",          count: 0,                       color: C.aiAccent, icon: Activity },
    // "My Team" — manage SWL's own workspace (the super_admin's tenant)
    // without having to navigate into /admin/[swl-id] as if it were a
    // client. Hidden when myCompanyBioId is null (super_admin without a
    // bio, edge case).
    ...(myCompanyBioId ? [{ label: "My Team", count: 0, color: "#7C3AED", icon: Users }] : []),
  ];

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Shield}
        section="Internal"
        title="Admin Panel"
        description="Manage clients, review tickets, and approve campaign requests."
        accentColor={C.aiAccent}
        status={{ label: "Internal", active: true }}
      />

      {/* Pending user assignments (hidden when empty) */}
      <PendingUsersSection />

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Clients",           value: stats.totalClients,     color: gold,      icon: Building2 },
          { label: "Total Leads",       value: stats.totalLeads,       color: C.blue,    icon: Users },
          { label: "Pending Approvals", value: stats.pendingApprovals, color: "#D97706", icon: Clock },
          { label: "Active Campaigns",  value: stats.activeCampaigns,  color: C.green,   icon: Megaphone },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${color}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
              <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}15` }}>
                <Icon size={13} style={{ color }} />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] duration-150 relative"
              style={{
                color: isActive ? t.color : C.textMuted,
                backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 6%, transparent)` : "transparent",
              }}>
              <Icon size={14} />
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 15%, transparent)` : C.surface, color: isActive ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}

        {/* Demos: separate route, but lives visually as a sister tab so admins
            can hop into impersonation without leaving the admin context. */}
        <Link
          href="/admin/demos"
          className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] duration-150 relative"
          style={{ color: C.textMuted }}
        >
          <Theater size={14} />
          Demos
          <ArrowRight size={11} style={{ opacity: 0.5 }} />
        </Link>

        {/* Reliability: DB ↔ Unipile ↔ n8n reconciliation. Lives next to Demos
            so the admin can spot ghost-sent rows or stuck queues without
            digging through Supabase. */}
        <Link
          href="/admin/reliability"
          className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] duration-150 relative"
          style={{ color: C.textMuted }}
        >
          <Zap size={14} />
          Reliability
          <ArrowRight size={11} style={{ opacity: 0.5 }} />
        </Link>

        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-1"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={13} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
      </div>

      {/* ═══ Tab 0: Clients ═══ */}
      {tab === 0 && (
        filteredClients.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Building2 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No clients match your search" : "No clients registered yet"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            {filteredClients.map((client, i) => {
              const totalPending = client.pendingProfiles + client.pendingCampaigns;
              return (
                <Link key={client.id} href={`/admin/${client.id}`}
                  className="flex items-center gap-5 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                  style={{ borderBottom: i < filteredClients.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  {client.logo_url ? (
                    <img src={client.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover border shrink-0" style={{ borderColor: C.border }} />
                  ) : (
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                      {client.company_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{client.company_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                      {[client.industry, client.location].filter(Boolean).join(" · ") || "No details"}
                    </p>
                  </div>
                  <div className="flex items-center gap-5 shrink-0">
                    {[
                      { label: "Leads",     value: client.leads },
                      { label: "Profiles",  value: client.profiles },
                      { label: "Campaigns", value: client.campaigns },
                    ].map(m => (
                      <div key={m.label} className="text-center min-w-[50px]">
                        <p className="text-base font-bold tabular-nums" style={{ color: C.textPrimary }}>{m.value}</p>
                        <p className="text-[10px]" style={{ color: C.textMuted }}>{m.label}</p>
                      </div>
                    ))}
                    {totalPending > 0 && (
                      <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                        <Clock size={10} /> {totalPending} pending
                      </span>
                    )}
                  </div>
                  <ChevronRight size={14} style={{ color: C.textDim }} className="shrink-0" />
                </Link>
              );
            })}
          </div>
        )
      )}

      {/* Users, Sellers, Aircall Access and Email Access live inside each client detail /admin/[id] */}

      {/* ═══ Tab 1: Pending Approvals ═══ */}
      {tab === 1 && (() => {
        const profiles = filteredApprovals.filter(a => a.type === "profile");
        const campaigns = filteredApprovals.filter(a => a.type === "campaign");

        if (filteredApprovals.length === 0) return (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No approvals match your search" : "All caught up — nothing to approve"}
            </p>
          </div>
        );

        return (
          <div className="space-y-6">
            {profiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Target size={14} style={{ color: C.blue }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Lead Gen Profiles ({profiles.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {profiles.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-4"
                      style={{ borderBottom: i < profiles.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${C.blue}12` }}>
                        <Target size={15} style={{ color: C.blue }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={item.href} className="text-sm font-semibold hover:underline" style={{ color: C.textPrimary }}>
                          {item.name}
                        </Link>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {item.clientName} · {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <AdminActions id={item.id} table="icp_profiles" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {campaigns.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone size={14} style={{ color: gold }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Campaign Requests ({campaigns.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {campaigns.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-4"
                      style={{ borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)` }}>
                        <Megaphone size={15} style={{ color: gold }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={item.href} className="text-sm font-semibold hover:underline" style={{ color: C.textPrimary }}>
                          {item.name}
                        </Link>
                        <p className="text-xs" style={{ color: C.textMuted }}>
                          {item.clientName} · {item.subtitle} · {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <Link href={item.href}
                        className="text-[10px] font-medium flex items-center gap-1 mr-2 hover:underline"
                        style={{ color: gold }}>
                        Review <ArrowRight size={10} />
                      </Link>
                      <AdminActions id={item.id} table="campaign_requests" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ Tab 2: Activity ═══ */}
      {tab === 2 && <ActivityWidget />}

      {/* ═══ Tab 3: My Team (super_admin's own workspace) ═══ */}
      {tab === 3 && myCompanyBioId && (
        <TenantTeamTab companyBioId={myCompanyBioId} canManage={true} />
      )}
    </div>
  );
}
