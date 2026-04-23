"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { UserPlus, AlertTriangle, Loader2 } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type PendingUser = { id: string; email: string; role: string | null; created_at: string };
type Company = { id: string; company_name: string };

export default function PendingUsersSection() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(d => {
        const all: any[] = d.users ?? [];
        setUsers(all.filter(u => !u.company_bio_id).map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at })));
        setCompanies(d.companies ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function assign(userId: string, patch: { role?: string; company_bio_id?: string | null }) {
    setSaving(userId);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (patch.company_bio_id) {
      setUsers(prev => prev.filter(u => u.id !== userId));
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...patch } : u));
    }
    setSaving(null);
  }

  if (loading) return null;
  if (users.length === 0) return null;

  return (
    <div className="rounded-xl border mb-6 overflow-hidden" style={{ backgroundColor: C.card, borderColor: "#FCD34D" }}>
      <div className="px-5 py-3 flex items-center gap-2 border-b" style={{ borderColor: C.border, backgroundColor: "#FFFBEB" }}>
        <AlertTriangle size={14} style={{ color: "#D97706" }} />
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#92400E" }}>
          Pending Assignment ({users.length})
        </h3>
        <span className="text-xs" style={{ color: "#92400E" }}>
          — {users.length === 1 ? "user" : "users"} signed up but not assigned to a company yet
        </span>
      </div>
      {users.map((user, i) => (
        <div key={user.id} className="flex items-center gap-4 px-5 py-3"
          style={{ borderBottom: i < users.length - 1 ? `1px solid ${C.border}` : "none" }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
            {user.email[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: C.textPrimary }}>{user.email}</p>
            <p className="text-[11px]" style={{ color: C.textDim }}>
              Signed up {new Date(user.created_at).toLocaleDateString()} · role: {user.role ?? "none"}
            </p>
          </div>
          <select
            value={user.role ?? ""}
            disabled={saving === user.id}
            onChange={e => assign(user.id, { role: e.target.value })}
            className="text-xs rounded-lg border px-2.5 py-1.5 outline-none"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
          >
            <option value="">— no role —</option>
            <option value="admin">admin</option>
            <option value="client">client</option>
          </select>
          <select
            value=""
            disabled={saving === user.id || !user.role}
            onChange={e => e.target.value && assign(user.id, { company_bio_id: e.target.value })}
            className="text-xs rounded-lg border px-2.5 py-1.5 outline-none max-w-[200px]"
            style={{ borderColor: "#D97706", color: "#D97706", backgroundColor: "#FFFBEB" }}
          >
            <option value="">— Assign to client —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          {saving === user.id && <Loader2 size={14} className="animate-spin" style={{ color: C.textDim }} />}
        </div>
      ))}
      <div className="px-5 py-2 text-[10px] italic" style={{ backgroundColor: C.bg, color: C.textDim, borderTop: `1px solid ${C.border}` }}>
        <UserPlus size={10} className="inline mr-1" />
        Tip: assign a role first, then pick a client. Assigning a client moves the user to that client&apos;s Users tab.
      </div>
    </div>
  );
}
