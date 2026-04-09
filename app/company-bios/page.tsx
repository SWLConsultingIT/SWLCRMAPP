"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Building2, Save, CheckCircle, AlertCircle, Plus, X } from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

type CompanyBio = {
  id?: string;
  company_name: string;
  industry: string;
  description: string;
  value_proposition: string;
  main_services: string[];
  target_market: string;
  differentiators: string;
  website: string;
  linkedin_url: string;
};

const empty: CompanyBio = {
  company_name: "",
  industry: "",
  description: "",
  value_proposition: "",
  main_services: [],
  target_market: "",
  differentiators: "",
  website: "",
  linkedin_url: "",
};

export default function CompanyBiosPage() {
  const [bio, setBio] = useState<CompanyBio>(empty);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newService, setNewService] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("company_bios")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data) setBio(data);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const payload = { ...bio, updated_at: new Date().toISOString() };

    let result;
    if (bio.id) {
      result = await supabase.from("company_bios").update(payload).eq("id", bio.id).select().single();
    } else {
      result = await supabase.from("company_bios").insert(payload).select().single();
    }

    if (result.error) {
      setError(result.error.message);
    } else {
      setBio(result.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  function addService() {
    const s = newService.trim();
    if (!s) return;
    setBio(b => ({ ...b, main_services: [...(b.main_services ?? []), s] }));
    setNewService("");
  }

  function removeService(i: number) {
    setBio(b => ({ ...b, main_services: b.main_services.filter((_, idx) => idx !== i) }));
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="p-8 w-full max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Setup</p>
        <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
          <Building2 size={22} style={{ color: gold }} />
          Company Bio
        </h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Esta información se usa para generar los mensajes de outreach personalizados.
        </p>
      </div>

      <div className="h-px mb-8" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      <div className="space-y-6">
        {/* Basic info */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Información básica</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Nombre de la empresa *</label>
              <input
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.company_name}
                onChange={e => setBio(b => ({ ...b, company_name: e.target.value }))}
                placeholder="Ej: SWL Consulting"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Industria</label>
              <input
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.industry}
                onChange={e => setBio(b => ({ ...b, industry: e.target.value }))}
                placeholder="Ej: SaaS, Consultoría, Manufactura"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Sitio web</label>
              <input
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.website}
                onChange={e => setBio(b => ({ ...b, website: e.target.value }))}
                placeholder="https://swlconsulting.com"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>LinkedIn de la empresa</label>
              <input
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.linkedin_url}
                onChange={e => setBio(b => ({ ...b, linkedin_url: e.target.value }))}
                placeholder="https://linkedin.com/company/swl-consulting"
              />
            </div>
          </div>
        </div>

        {/* Pitch */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Propuesta de valor</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Descripción de la empresa</label>
              <textarea
                rows={3}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.description}
                onChange={e => setBio(b => ({ ...b, description: e.target.value }))}
                placeholder="Qué hace la empresa, cuál es su misión, cuántos años tiene, etc."
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Value proposition</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.value_proposition}
                onChange={e => setBio(b => ({ ...b, value_proposition: e.target.value }))}
                placeholder="En una oración: qué problema resuelve y para quién"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Diferenciadores</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={bio.differentiators}
                onChange={e => setBio(b => ({ ...b, differentiators: e.target.value }))}
                placeholder="Qué hace a esta empresa diferente de la competencia"
              />
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Servicios principales</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {(bio.main_services ?? []).map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: goldLight, color: gold, border: `1px solid rgba(201,168,58,0.3)` }}>
                {s}
                <button onClick={() => removeService(i)} className="ml-0.5 opacity-60 hover:opacity-100">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border px-3.5 py-2 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={newService}
              onChange={e => setNewService(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addService()}
              placeholder="Agregar servicio…"
            />
            <button
              onClick={addService}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: goldLight, color: gold, border: `1px solid rgba(201,168,58,0.3)` }}>
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>

        {/* Target market */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Mercado objetivo</h2>
          <textarea
            rows={3}
            className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={bio.target_market}
            onChange={e => setBio(b => ({ ...b, target_market: e.target.value }))}
            placeholder="Describe el tipo de cliente ideal: industria, tamaño de empresa, geografía, cargo del decisor, etc."
          />
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !bio.company_name}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            <Save size={15} />
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: C.green }}>
              <CheckCircle size={15} /> Guardado
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: C.red }}>
              <AlertCircle size={15} /> {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
