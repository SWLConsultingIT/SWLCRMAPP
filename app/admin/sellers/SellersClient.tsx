"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import Breadcrumb from "@/components/Breadcrumb";
import {
  Plus, Pencil, Trash2, Save, X, Loader2, Check,
  Share2, Mail, Phone, MessageCircle, UserCircle,
} from "lucide-react";

type Seller = {
  id: string;
  name: string;
  active: boolean;
  linkedin_account_id: string | null;
  linkedin_daily_limit: number | null;
  linkedin_connections_limit: number | null;
  email_account: string | null;
  email_daily_limit: number | null;
  whatsapp_account: string | null;
  whatsapp_daily_limit: number | null;
  instagram_account: string | null;
  telegram_account: string | null;
  unipile_account_id: string | null;
  call_daily_limit: number | null;
  created_at?: string;
};

const gold = "#C9A83A";

const emptySeller = (): Partial<Seller> => ({
  name: "",
  active: true,
  linkedin_account_id: "",
  linkedin_daily_limit: 50,
  linkedin_connections_limit: 20,
  email_account: "",
  email_daily_limit: 30,
  whatsapp_account: "",
  whatsapp_daily_limit: 50,
  unipile_account_id: "",
  call_daily_limit: 30,
});

export default function SellersClient({
  initialSellers,
  stats,
}: {
  initialSellers: Seller[];
  stats: Record<string, { active: number; total: number }>;
}) {
  const router = useRouter();
  const [sellers, setSellers] = useState<Seller[]>(initialSellers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Seller>>({});
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Partial<Seller>>(emptySeller());
  const [saving, setSaving] = useState(false);

  function startEdit(s: Seller) {
    setEditingId(s.id);
    setDraft({ ...s });
    setCreating(false);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    const res = await fetch(`/api/sellers/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setSellers(prev => prev.map(s => s.id === editingId ? { ...s, ...draft } as Seller : s));
      setEditingId(null);
      setDraft({});
      router.refresh();
    } else {
      alert("Failed to save");
    }
    setSaving(false);
  }

  async function createSeller() {
    if (!newDraft.name?.trim()) { alert("Name is required"); return; }
    setSaving(true);
    const res = await fetch("/api/sellers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newDraft),
    });
    if (res.ok) {
      const { seller } = await res.json();
      setSellers(prev => [seller, ...prev]);
      setCreating(false);
      setNewDraft(emptySeller());
      router.refresh();
    } else {
      alert("Failed to create");
    }
    setSaving(false);
  }

  async function deleteSeller(s: Seller) {
    if (!confirm(`Delete seller "${s.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/sellers/${s.id}`, { method: "DELETE" });
    if (res.ok) {
      setSellers(prev => prev.filter(x => x.id !== s.id));
      router.refresh();
    } else {
      alert("Failed to delete");
    }
  }

  async function toggleActive(s: Seller) {
    const res = await fetch(`/api/sellers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    if (res.ok) {
      setSellers(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active } : x));
    }
  }

  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <Breadcrumb crumbs={[{ label: "Admin", href: "/admin" }, { label: "Sellers" }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Administration</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Sellers</h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>Manage your sales team, accounts, and daily limits.</p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditingId(null); }}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: gold, color: "#04070d" }}
        >
          <Plus size={14} /> Add Seller
        </button>
      </div>

      {/* ═══ CREATE NEW ═══ */}
      {creating && (
        <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: gold, borderWidth: 1.5 }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold" style={{ color: gold }}>New Seller</h2>
            <button onClick={() => { setCreating(false); setNewDraft(emptySeller()); }}>
              <X size={16} style={{ color: C.textMuted }} />
            </button>
          </div>
          <SellerForm draft={newDraft} setDraft={setNewDraft} />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setCreating(false); setNewDraft(emptySeller()); }}
              className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ color: C.textMuted }}>
              Cancel
            </button>
            <button onClick={createSeller} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: gold, color: "#04070d" }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* ═══ SELLERS LIST ═══ */}
      {sellers.length === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <UserCircle size={32} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm" style={{ color: C.textMuted }}>No sellers yet. Add your first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sellers.map(s => {
            const isEditing = editingId === s.id;
            const st = stats[s.id] ?? { active: 0, total: 0 };

            if (isEditing) {
              return (
                <div key={s.id} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.blue, borderWidth: 1.5 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold" style={{ color: C.blue }}>Editing: {s.name}</h2>
                    <button onClick={() => { setEditingId(null); setDraft({}); }}>
                      <X size={16} style={{ color: C.textMuted }} />
                    </button>
                  </div>
                  <SellerForm draft={draft} setDraft={setDraft} />
                  <div className="flex justify-end gap-2 mt-4">
                    <button onClick={() => { setEditingId(null); setDraft({}); }}
                      className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ color: C.textMuted }}>
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                      style={{ backgroundColor: C.blue, color: "#fff" }}>
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={s.id} className="rounded-xl border p-4 flex items-center gap-4" style={{ backgroundColor: C.card, borderColor: C.border, opacity: s.active ? 1 : 0.6 }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
                  {s.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{s.name}</h3>
                    <button onClick={() => toggleActive(s)}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full transition-all"
                      style={{
                        backgroundColor: s.active ? C.greenLight : "#F3F4F6",
                        color: s.active ? C.green : C.textMuted,
                      }}>
                      {s.active ? "ACTIVE" : "INACTIVE"}
                    </button>
                    <span className="text-[10px]" style={{ color: C.textDim }}>
                      {st.active} active · {st.total} total campaigns
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-[10px]" style={{ color: C.textMuted }}>
                    {s.unipile_account_id && (
                      <span className="flex items-center gap-1" style={{ color: "#0A66C2" }}>
                        <Share2 size={10} /> Unipile: {s.linkedin_daily_limit ?? "—"}/d
                      </span>
                    )}
                    {s.email_account && (
                      <span className="flex items-center gap-1" style={{ color: "#7C3AED" }}>
                        <Mail size={10} /> {s.email_account} · {s.email_daily_limit ?? "—"}/d
                      </span>
                    )}
                    {s.whatsapp_account && (
                      <span className="flex items-center gap-1" style={{ color: "#22c55e" }}>
                        <MessageCircle size={10} /> WA: {s.whatsapp_daily_limit ?? "—"}/d
                      </span>
                    )}
                    {s.call_daily_limit && (
                      <span className="flex items-center gap-1" style={{ color: "#F97316" }}>
                        <Phone size={10} /> {s.call_daily_limit}/d calls
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(s)}
                    className="p-2 rounded-lg transition-colors hover:bg-gray-100"
                    style={{ color: C.textMuted }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteSeller(s)}
                    className="p-2 rounded-lg transition-colors hover:bg-red-50"
                    style={{ color: C.red }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// FORM COMPONENT
// ═══════════════════════════════════════════════════════
function SellerForm({
  draft, setDraft,
}: {
  draft: Partial<Seller>;
  setDraft: (d: Partial<Seller>) => void;
}) {
  const set = (k: keyof Seller, v: unknown) => setDraft({ ...draft, [k]: v });
  const Field = ({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) => (
    <div className={full ? "col-span-3" : ""}>
      <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.textDim }}>{label}</label>
      {children}
    </div>
  );
  const inputStyle = { backgroundColor: "#F9FAFB", borderColor: C.border, color: C.textBody };

  return (
    <div className="grid grid-cols-3 gap-4">
      <Field label="Name *">
        <input value={draft.name ?? ""} onChange={e => set("name", e.target.value)}
          placeholder="Francisco Fontana"
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="Active">
        <div className="flex items-center h-[34px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={draft.active ?? true} onChange={e => set("active", e.target.checked)} />
            <span className="text-xs" style={{ color: C.textBody }}>{draft.active ?? true ? "Yes" : "No"}</span>
          </label>
        </div>
      </Field>

      <div />

      <Field label="LinkedIn Unipile Account ID">
        <input value={draft.unipile_account_id ?? ""} onChange={e => set("unipile_account_id", e.target.value)}
          placeholder="JuCj27EVTb6WSmqMslB8NA"
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none font-mono" style={inputStyle} />
      </Field>

      <Field label="LinkedIn Daily Msgs">
        <input type="number" value={draft.linkedin_daily_limit ?? ""} onChange={e => set("linkedin_daily_limit", Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="LinkedIn Daily Connections">
        <input type="number" value={draft.linkedin_connections_limit ?? ""} onChange={e => set("linkedin_connections_limit", Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="Email Account">
        <input value={draft.email_account ?? ""} onChange={e => set("email_account", e.target.value)}
          placeholder="contact@swladvisory.com"
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="Email Daily Limit">
        <input type="number" value={draft.email_daily_limit ?? ""} onChange={e => set("email_daily_limit", Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="Call Daily Limit">
        <input type="number" value={draft.call_daily_limit ?? ""} onChange={e => set("call_daily_limit", Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="WhatsApp Account">
        <input value={draft.whatsapp_account ?? ""} onChange={e => set("whatsapp_account", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <Field label="WhatsApp Daily">
        <input type="number" value={draft.whatsapp_daily_limit ?? ""} onChange={e => set("whatsapp_daily_limit", Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border text-xs outline-none" style={inputStyle} />
      </Field>

      <div />
    </div>
  );
}
