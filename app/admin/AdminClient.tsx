"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Building2, Users, Megaphone, Clock, ChevronRight,
  Target, Search, X, CheckCircle, ArrowRight, Shield,
  Trash2, Loader2, Share2, AlertTriangle, Phone, Mail,
} from "lucide-react";
import AdminActions from "./AdminActions";
import PageHero from "@/components/PageHero";
import PendingUsersSection from "./PendingUsersSection";

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
              backgroundColor: user.role === "admin" ? `${gold}12` : C.card,
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
              style={{ background: seller.active ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` : "#E5E7EB", color: seller.active ? "#fff" : "#9CA3AF" }}
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
                            className="rounded-lg border p-3 flex items-center gap-3 text-left transition-all hover:shadow-sm disabled:opacity-60"
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
type CompanyWithEmails = { id: string; company_name: string; email_accounts: string[] | null };

function EmailAccessTab() {
  const [emails, setEmails] = useState<InstantlyEmail[]>([]);
  const [companies, setCompanies] = useState<CompanyWithEmails[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/email-access")
      .then(r => r.json())
      .then(d => { setEmails(d.emails ?? []); setCompanies(d.companies ?? []); })
      .finally(() => setLoading(false));
  }, []);

  async function toggleEmail(companyId: string, email: string) {
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    const current = company.email_accounts ?? [];
    const next = current.includes(email) ? current.filter(e => e !== email) : [...current, email];

    setSaving(companyId);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, email_accounts: next } : c));
    try {
      await fetch("/api/admin/email-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyBioId: companyId, emailAccounts: next }),
      });
    } finally {
      setSaving(null);
    }
  }

  // Group emails by domain for cleaner UI
  const emailsByDomain = emails.reduce<Record<string, InstantlyEmail[]>>((acc, e) => {
    const domain = e.email.split("@")[1] ?? "other";
    if (!acc[domain]) acc[domain] = [];
    acc[domain].push(e);
    return acc;
  }, {});

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={20} className="animate-spin" style={{ color: C.textDim }} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs" style={{ color: C.textBody }}>
          <span className="font-semibold">One shared Instantly account with {emails.length} emails.</span>
          <span style={{ color: C.textMuted }}> Assign to each client which emails they can use (typically their own domains). If no emails are assigned, the client won&apos;t see any in the Accounts page or campaign creation (admins still see all).</span>
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        {companies.map((company, i) => {
          const assigned = company.email_accounts ?? [];
          const isExpanded = expandedId === company.id;
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
                    {assigned.length === 0 ? "No emails assigned" : `${assigned.length} email${assigned.length > 1 ? "s" : ""} assigned`}
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
                  {Object.keys(emailsByDomain).length === 0 ? (
                    <p className="text-xs italic" style={{ color: C.textDim }}>No Instantly emails available.</p>
                  ) : (
                    Object.entries(emailsByDomain).sort((a, b) => a[0].localeCompare(b[0])).map(([domain, list]) => {
                      const allAssignedInDomain = list.every(e => assigned.includes(e.email));
                      const someAssignedInDomain = list.some(e => assigned.includes(e.email));
                      return (
                        <div key={domain}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
                              {domain} <span className="font-medium" style={{ color: C.textDim }}>({list.length})</span>
                            </p>
                            <button
                              onClick={() => {
                                const next = allAssignedInDomain
                                  ? assigned.filter(e => !list.some(l => l.email === e))
                                  : [...new Set([...assigned, ...list.map(l => l.email)])];
                                setSaving(company.id);
                                setCompanies(prev => prev.map(c => c.id === company.id ? { ...c, email_accounts: next } : c));
                                fetch("/api/admin/email-access", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ companyBioId: company.id, emailAccounts: next }),
                                }).finally(() => setSaving(null));
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
                                  className="rounded-lg border p-3 flex items-center gap-3 text-left transition-all hover:shadow-sm disabled:opacity-60"
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
                                    <p className="text-[11px] font-semibold truncate" style={{ color: C.textPrimary }}>
                                      {e.email}
                                    </p>
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
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
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

export default function AdminClient({ clients, pendingApprovals, stats }: Props) {
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
    { label: "Clients",           count: clients.length,          color: gold },
    { label: "Pending Approvals", count: pendingApprovals.length, color: "#D97706" },
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
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : "#F3F4F6", color: isActive ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
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
                        style={{ backgroundColor: `${gold}12` }}>
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
    </div>
  );
}
