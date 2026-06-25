"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { UserPlus, AlertTriangle, Trash2, Loader2 } from "lucide-react";
import AddPersonModal, { type AddPersonResult } from "./AddPersonModal";
import { useToast } from "@/lib/toast";

const gold = "var(--brand, #c9a83a)";

type PendingUser = { id: string; email: string; role: string | null; created_at: string };
type Company = { id: string; company_name: string };

export default function PendingUsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignTarget, setAssignTarget] = useState<PendingUser | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(d => {
        const all: Array<{ id: string; email: string; role: string | null; company_bio_id: string | null; created_at: string }> = d.users ?? [];
        setUsers(all.filter(u => !u.company_bio_id).map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at })));
        setCompanies(d.companies ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSuccess(target: PendingUser, result: AddPersonResult) {
    setAssignTarget(null);
    // Membership(s) created → the user now has a home tenant and drops out of
    // the pending list.
    setUsers(prev => prev.filter(u => u.id !== target.id));
    const where = result.count > 1 ? `${result.count} companies` : "the company";
    toast.show({ kind: "success", title: `${target.email} added to ${where}` });
  }

  async function removeUser(user: PendingUser) {
    if (!window.confirm(`Delete ${user.email}? This permanently removes the account. They'll have to sign up again.`)) return;
    setDeleting(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.show({ kind: "error", title: "Couldn't delete", description: d.error ?? "Try again." });
        return;
      }
      setUsers(prev => prev.filter(u => u.id !== user.id));
      toast.show({ kind: "success", title: `${user.email} deleted` });
    } catch {
      toast.show({ kind: "error", title: "Network error", description: "Try again in a moment." });
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return null;
  if (users.length === 0) return null;

  return (
    <div className="rounded-xl border mb-6 overflow-hidden" style={{ backgroundColor: C.card, borderColor: "color-mix(in srgb, #D97706 34%, transparent)" }}>
      <div className="px-5 py-3 flex items-center gap-2 border-b" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)" }}>
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
              Signed up {new Date(user.created_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => setAssignTarget(user)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ borderColor: "#D97706", color: "#fff", backgroundColor: "#D97706" }}
          >
            <UserPlus size={12} /> Assign to companies…
          </button>
          <button
            onClick={() => removeUser(user)}
            disabled={deleting === user.id}
            title="Delete account"
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-black/[0.05] shrink-0 disabled:opacity-50"
            style={{ color: C.red }}
          >
            {deleting === user.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      ))}
      <div className="px-5 py-2 text-[10px] italic" style={{ backgroundColor: C.bg, color: C.textDim, borderTop: `1px solid ${C.border}` }}>
        <UserPlus size={10} className="inline mr-1" />
        Tip: pick one or more companies and a role. The user gets real access to each one and drops off this list.
      </div>

      {assignTarget && (
        <AddPersonModal
          companies={companies}
          presetEmail={assignTarget.email}
          onClose={() => setAssignTarget(null)}
          onSuccess={(result) => handleSuccess(assignTarget, result)}
        />
      )}
    </div>
  );
}
