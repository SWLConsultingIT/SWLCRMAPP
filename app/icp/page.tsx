"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Target, Plus, X, CheckCircle, AlertCircle, Clock, Loader2 } from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

type IcpProfile = {
  id: string;
  company_bio_id: string | null;
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  company_size: string;
  geography: string[];
  pain_points: string;
  solutions_offered: string;
  notes: string;
  status: "pending" | "reviewed" | "approved";
  created_at: string;
};

const emptyForm = {
  profile_name: "",
  target_industries: [] as string[],
  target_roles: [] as string[],
  company_size: "",
  geography: [] as string[],
  pain_points: "",
  solutions_offered: "",
  notes: "",
};

const statusConfig = {
  pending:  { label: "Pending review", color: C.yellow,  bg: C.yellowLight },
  reviewed: { label: "Reviewed",       color: C.blue,    bg: C.blueLight },
  approved: { label: "Approved",       color: C.green,   bg: C.greenLight },
};

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  function add() {
    const s = input.trim();
    if (!s || values.includes(s)) return;
    onChange([...values, s]);
    setInput("");
  }
  return (
    <div className="tag-input rounded-lg border px-3 py-2 flex flex-wrap gap-1.5 min-h-10 cursor-text transition-colors"
      style={{ borderColor: C.border, backgroundColor: C.bg }}
      onClick={e => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {values.map(v => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: goldLight, color: gold, border: `1px solid rgba(201,168,58,0.25)` }}>
          {v}
          <button onClick={() => onChange(values.filter(x => x !== v))} className="opacity-60 hover:opacity-100"><X size={10} /></button>
        </span>
      ))}
      <input
        className="flex-1 min-w-24 text-sm bg-transparent outline-none border-none shadow-none"
        style={{ color: C.textPrimary, border: "none", boxShadow: "none" }}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), add())}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

export default function IcpPage() {
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProfiles() {
    const { data } = await supabase
      .from("icp_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setProfiles(data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadProfiles(); }, []);

  async function handleSubmit() {
    setSaving(true);
    setError(null);

    // Get latest company bio id
    const { data: bio } = await supabase
      .from("company_bios")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data, error: err } = await supabase
      .from("icp_profiles")
      .insert({ ...form, company_bio_id: bio?.id ?? null, status: "pending" })
      .select()
      .single();

    if (err) {
      setError(err.message);
    } else {
      setSavedId(data.id);
      setShowForm(false);
      setForm(emptyForm);
      await loadProfiles();
      setTimeout(() => setSavedId(null), 4000);
    }
    setSaving(false);
  }

  return (
    <div className="p-8 w-full max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Setup</p>
          <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
            <Target size={22} style={{ color: gold }} />
            Ideal Customer Profile
          </h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>
            Define el perfil del prospecto ideal. El equipo SWL lo revisará antes de armar la campaña.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            <Plus size={15} /> Nuevo ICP
          </button>
        )}
      </div>

      <div className="h-px mb-8" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* New ICP form */}
      {showForm && (
        <div className="rounded-xl border mb-8" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Nuevo perfil ICP</h2>
            <button onClick={() => { setShowForm(false); setForm(emptyForm); }} style={{ color: C.textMuted }}>
              <X size={18} />
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Nombre del perfil *</label>
              <input
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={form.profile_name}
                onChange={e => setForm(f => ({ ...f, profile_name: e.target.value }))}
                placeholder="Ej: CFO de Pyme Argentina"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Industrias objetivo</label>
                <TagInput
                  values={form.target_industries}
                  onChange={v => setForm(f => ({ ...f, target_industries: v }))}
                  placeholder="Escribir y presionar Enter…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Roles objetivo</label>
                <TagInput
                  values={form.target_roles}
                  onChange={v => setForm(f => ({ ...f, target_roles: v }))}
                  placeholder="CEO, CFO, Gerente de Ventas…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Tamaño de empresa</label>
                <select
                  className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none bg-transparent"
                  style={{ borderColor: C.border, color: form.company_size ? C.textPrimary : C.textDim, backgroundColor: C.bg }}
                  value={form.company_size}
                  onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))}>
                  <option value="">Cualquier tamaño</option>
                  <option value="1-10">1–10 empleados</option>
                  <option value="11-50">11–50 empleados</option>
                  <option value="51-200">51–200 empleados</option>
                  <option value="201-500">201–500 empleados</option>
                  <option value="500+">500+ empleados</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Geografía</label>
                <TagInput
                  values={form.geography}
                  onChange={v => setForm(f => ({ ...f, geography: v }))}
                  placeholder="Argentina, España, LATAM…"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Dolor / problema que resuelves</label>
              <textarea
                rows={3}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={form.pain_points}
                onChange={e => setForm(f => ({ ...f, pain_points: e.target.value }))}
                placeholder="Qué problema tienen estos prospectos que tu empresa puede resolver"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Soluciones que ofreces para este perfil</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={form.solutions_offered}
                onChange={e => setForm(f => ({ ...f, solutions_offered: e.target.value }))}
                placeholder="Qué servicio/producto específico encaja mejor con este perfil"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Notas adicionales</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Contexto adicional, referencias, casos de éxito similares…"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg p-3 text-sm" style={{ backgroundColor: C.redLight, color: C.red }}>
                <AlertCircle size={15} /> {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSubmit}
                disabled={saving || !form.profile_name}
                className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ backgroundColor: gold, color: "#04070d" }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? "Enviando…" : "Enviar para revisión"}
              </button>
              <span className="text-xs" style={{ color: C.textMuted }}>
                El equipo SWL recibirá una notificación para revisar este perfil.
              </span>
            </div>
          </div>
        </div>
      )}

      {savedId && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-6 text-sm font-medium"
          style={{ backgroundColor: C.greenLight, color: C.green, border: `1px solid ${C.green}22` }}>
          <CheckCircle size={15} /> Perfil enviado para revisión. El equipo SWL lo revisará pronto.
        </div>
      )}

      {/* Profiles list */}
      {loading ? (
        <div className="flex items-center justify-center py-12" style={{ color: C.textMuted }}>
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando…
        </div>
      ) : profiles.length === 0 && !showForm ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Target size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>No hay perfiles ICP todavía</p>
          <p className="text-xs mt-1 mb-4" style={{ color: C.textMuted }}>Crea el primero para empezar a armar campañas</p>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg px-5 py-2 text-sm font-semibold"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            Nuevo ICP
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {profiles.map(p => {
            const st = statusConfig[p.status] ?? statusConfig.pending;
            return (
              <div key={p.id} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-base" style={{ color: C.textPrimary }}>{p.profile_name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                      {new Date(p.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                    style={{ backgroundColor: st.bg, color: st.color }}>
                    <Clock size={11} /> {st.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 text-xs">
                  {p.target_industries?.length > 0 && (
                    <div>
                      <p className="font-medium mb-1" style={{ color: C.textMuted }}>Industrias</p>
                      <div className="flex flex-wrap gap-1">
                        {p.target_industries.map(i => (
                          <span key={i} className="rounded-full px-2 py-0.5 font-medium"
                            style={{ backgroundColor: C.blueLight, color: C.blue }}>{i}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.target_roles?.length > 0 && (
                    <div>
                      <p className="font-medium mb-1" style={{ color: C.textMuted }}>Roles</p>
                      <div className="flex flex-wrap gap-1">
                        {p.target_roles.map(r => (
                          <span key={r} className="rounded-full px-2 py-0.5 font-medium"
                            style={{ backgroundColor: C.accentLight, color: C.accent }}>{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.geography?.length > 0 && (
                    <div>
                      <p className="font-medium mb-1" style={{ color: C.textMuted }}>Geografía</p>
                      <div className="flex flex-wrap gap-1">
                        {p.geography.map(g => (
                          <span key={g} className="rounded-full px-2 py-0.5 font-medium"
                            style={{ backgroundColor: C.orangeLight, color: C.orange }}>{g}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {p.pain_points && (
                  <p className="text-xs mt-3 line-clamp-2" style={{ color: C.textBody }}>
                    <span className="font-medium" style={{ color: C.textMuted }}>Dolor: </span>{p.pain_points}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
