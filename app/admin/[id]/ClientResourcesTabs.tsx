"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { Users, Share2, Phone, Mail, Loader2, CheckCircle, AlertTriangle, Trash2 } from "lucide-react";

const gold = "#C9A83A";

type Props = { companyBioId: string; companyName: string };

type UserRow = { id: string; email: string; role: string | null; company_bio_id: string | null; created_at: string };
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
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              <Icon size={13} /> {t.label}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
      </div>

      <div className="p-5">
        {tab === 0 && <ClientUsers companyBioId={companyBioId} />}
        {tab === 1 && <ClientSellers companyBioId={companyBioId} />}
        {tab === 2 && <ClientAircall companyBioId={companyBioId} />}
        {tab === 3 && <ClientEmails companyBioId={companyBioId} />}
      </div>
    </div>
  );
}

// ═══ USERS ══════════════════════════════════════════════════════════════════
function ClientUsers({ companyBioId }: { companyBioId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(d => setUsers((d.users ?? []).filter((u: UserRow) => u.company_bio_id === companyBioId)))
      .finally(() => setLoading(false));
  }, [companyBioId]);

  async function remove(userId: string) {
    setSaving(userId);
    await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setUsers(prev => prev.filter(u => u.id !== userId));
    setSaving(null);
  }

  if (loading) return <Spinner />;

  if (users.length === 0) return (
    <EmptyState icon={Users} text="No users assigned to this client yet" sub="Users self-signup, then you assign them here from the global Users view." />
  );

  return (
    <div className="divide-y" style={{ borderColor: C.border }}>
      {users.map(user => (
        <div key={user.id} className="flex items-center gap-4 py-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
            {user.email[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{user.email}</p>
            <p className="text-[11px]" style={{ color: C.textDim }}>
              {user.role ? `${user.role} · joined ${new Date(user.created_at).toLocaleDateString()}` : "No role"}
            </p>
          </div>
          {saving === user.id ? (
            <Loader2 size={14} className="animate-spin" style={{ color: C.textDim }} />
          ) : (
            <button onClick={() => remove(user.id)} title="Remove from client"
              className="p-1.5 rounded-lg hover:bg-red-50">
              <Trash2 size={13} style={{ color: C.textDim }} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

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
              style={{ background: seller.active ? `linear-gradient(135deg, ${gold}, #e8c84a)` : "#E5E7EB", color: seller.active ? "#fff" : "#9CA3AF" }}>
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
              className="rounded-lg border p-3 flex items-center gap-3 text-left transition-all hover:shadow-sm disabled:opacity-60"
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
function ClientEmails({ companyBioId }: { companyBioId: string }) {
  const [emails, setEmails] = useState<InstantlyEmail[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/email-access")
      .then(r => r.json())
      .then(d => {
        setEmails(d.emails ?? []);
        const me = (d.companies ?? []).find((c: any) => c.id === companyBioId);
        setAssigned(me?.email_accounts ?? []);
      })
      .finally(() => setLoading(false));
  }, [companyBioId]);

  async function save(next: string[]) {
    setAssigned(next);
    setSaving(true);
    await fetch("/api/admin/email-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyBioId, emailAccounts: next }),
    });
    setSaving(false);
  }

  function toggle(email: string) {
    save(assigned.includes(email) ? assigned.filter(e => e !== email) : [...assigned, email]);
  }

  if (loading) return <Spinner />;

  if (emails.length === 0) return <EmptyState icon={Mail} text="No Instantly emails available" />;

  const byDomain = emails.reduce<Record<string, InstantlyEmail[]>>((acc, e) => {
    const d = e.email.split("@")[1] ?? "other";
    (acc[d] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: C.textMuted }}>
        {saving && <Loader2 size={11} className="inline animate-spin mr-1" />}
        Emails grouped by domain. Click to toggle, or assign/unassign a full domain at once.
      </p>
      {Object.entries(byDomain).sort((a, b) => a[0].localeCompare(b[0])).map(([domain, list]) => {
        const allAssigned = list.every(e => assigned.includes(e.email));
        const someAssigned = list.some(e => assigned.includes(e.email));
        return (
          <div key={domain}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
                {domain} <span className="font-medium" style={{ color: C.textDim }}>({list.length})</span>
              </p>
              <button onClick={() => save(allAssigned ? assigned.filter(e => !list.some(l => l.email === e)) : [...new Set([...assigned, ...list.map(l => l.email)])])}
                className="text-[10px] font-semibold"
                style={{ color: allAssigned ? C.red : "#7C3AED" }}>
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
