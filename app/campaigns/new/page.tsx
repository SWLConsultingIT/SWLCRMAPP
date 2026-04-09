"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  Megaphone, ArrowLeft, ArrowRight, Check, Share2, Mail, Phone, MessageCircle,
  Loader2, Sparkles, Pencil, Target, Building2, Send,
} from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

type IcpProfile = { id: string; profile_name: string; target_industries: string[]; target_roles: string[]; company_size: string; pain_points: string; solutions_offered: string };
type CompanyBio = { id: string; company_name: string; industry: string; description: string; value_proposition: string; main_services: string[]; differentiators: string };

const channelOptions = [
  { key: "linkedin", label: "LinkedIn", icon: Share2, color: C.linkedin, desc: "Connection request + mensajes" },
  { key: "email",    label: "Email",    icon: Mail,   color: C.email,    desc: "Secuencia de emails vía Instantly" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#22c55e", desc: "Mensajes directos (próximamente)" },
  { key: "call",     label: "Llamada",  icon: Phone,  color: C.phone,    desc: "Cola de llamadas para vendedor" },
];

const STEPS = ["ICP", "Canales", "Secuencia", "Mensajes", "Revisión"];

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Data
  const [icps, setIcps] = useState<IcpProfile[]>([]);
  const [bio, setBio] = useState<CompanyBio | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState("");
  const [selectedIcp, setSelectedIcp] = useState<string | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [sequenceLength, setSequenceLength] = useState(5);
  const [frequencyDays, setFrequencyDays] = useState(3);
  const [targetLeads, setTargetLeads] = useState(50);
  const [prompts, setPrompts] = useState<Record<string, { subject?: string; body: string }[]>>({});
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: icpData }, { data: bioData }] = await Promise.all([
        supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles, company_size, pain_points, solutions_offered").in("status", ["approved", "pending"]).order("created_at", { ascending: false }),
        supabase.from("company_bios").select("*").order("created_at", { ascending: false }).limit(1).single(),
      ]);
      setIcps(icpData ?? []);
      setBio(bioData);
      setLoading(false);
    }
    load();
  }, []);

  function toggleChannel(ch: string) {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  }

  async function generatePrompts() {
    if (!selectedIcp || !bio) return;
    setGenerating(true);

    const icp = icps.find(i => i.id === selectedIcp);

    // Build prompt suggestions per channel per step
    const generated: Record<string, { subject?: string; body: string }[]> = {};

    for (const ch of channels) {
      const steps: { subject?: string; body: string }[] = [];
      for (let i = 0; i < sequenceLength; i++) {
        const stepNum = i + 1;
        const isFirst = i === 0;

        if (ch === "linkedin") {
          if (isFirst) {
            steps.push({ body: `Hola {{first_name}}, vi que trabajás en {{company}} como {{role}}. En ${bio.company_name} ayudamos a empresas de ${icp?.target_industries?.join(", ") || "tu industria"} con ${bio.main_services?.slice(0, 2).join(" y ") || "nuestros servicios"}. ¿Te interesaría una charla breve?` });
          } else if (stepNum === 2) {
            steps.push({ body: `{{first_name}}, quería hacer seguimiento. ${bio.value_proposition || "Ayudamos a empresas como la tuya a crecer"}. ¿Tenés 15 minutos esta semana?` });
          } else {
            steps.push({ body: `Último mensaje, {{first_name}}. ${bio.differentiators || "Nuestros clientes ven resultados en pocas semanas"}. Si te interesa, estoy disponible. Si no, sin problema.` });
          }
        } else if (ch === "email") {
          if (isFirst) {
            steps.push({
              subject: `${bio.company_name} + {{company}} — ${icp?.pain_points?.slice(0, 40) || "oportunidad"}`,
              body: `Hola {{first_name}},\n\nSoy de ${bio.company_name}. ${bio.description?.slice(0, 100) || ""}\n\nVi que en {{company}} podrían beneficiarse de ${bio.main_services?.slice(0, 2).join(" y ") || "lo que hacemos"}, especialmente para ${icp?.pain_points?.slice(0, 80) || "resolver desafíos clave"}.\n\n¿Tienen disponibilidad para una charla de 15 minutos?\n\nSaludos`,
            });
          } else if (stepNum === 2) {
            steps.push({
              subject: `Re: ${bio.company_name} + {{company}}`,
              body: `Hola {{first_name}},\n\nQuería hacer un seguimiento de mi mensaje anterior. ${bio.value_proposition || ""}\n\n¿Les interesaría explorar cómo podemos ayudar?\n\nSaludos`,
            });
          } else {
            steps.push({
              subject: `Última consulta — ${bio.company_name}`,
              body: `{{first_name}},\n\nÚltimo contacto, no quiero ser insistente. ${bio.differentiators || "Nuestros clientes suelen ver resultados rápido"}.\n\nSi en algún momento les interesa, estoy disponible.\n\nSaludos`,
            });
          }
        } else if (ch === "call") {
          steps.push({ body: `Llamar a {{first_name}} de {{company}}. Mencionar: ${bio.main_services?.slice(0, 2).join(", ") || "servicios"} para ${icp?.target_industries?.slice(0, 2).join(", ") || "su industria"}.` });
        } else {
          steps.push({ body: `Hola {{first_name}}, soy de ${bio.company_name}. ${bio.value_proposition || ""}. ¿Podemos charlar?` });
        }
      }
      generated[ch] = steps;
    }

    setPrompts(generated);
    setGenerating(false);
  }

  async function handleSubmit() {
    setSubmitting(true);

    const { error } = await supabase.from("campaign_requests").insert({
      name,
      icp_profile_id: selectedIcp,
      channels,
      sequence_length: sequenceLength,
      frequency_days: frequencyDays,
      target_leads_count: targetLeads,
      message_prompts: prompts,
      status: "pending_review",
    });

    if (!error) {
      router.push("/campaigns?submitted=1");
    }
    setSubmitting(false);
  }

  const canNext = () => {
    if (step === 0) return !!selectedIcp && name.length > 0;
    if (step === 1) return channels.length > 0;
    if (step === 2) return true;
    if (step === 3) return Object.keys(prompts).length > 0;
    return true;
  };

  if (loading) {
    return <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}><Loader2 size={20} className="animate-spin mr-2" /> Cargando…</div>;
  }

  return (
    <div className="p-8 w-full max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push("/campaigns")} className="flex items-center gap-1.5 text-xs font-medium mb-3 transition-colors hover:opacity-80" style={{ color: C.textMuted }}>
          <ArrowLeft size={13} /> Volver a campañas
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Create</p>
        <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
          <Megaphone size={22} style={{ color: gold }} />
          Nueva Campaña
        </h1>
      </div>

      <div className="h-px mb-8" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={i === step
                ? { backgroundColor: gold, color: "#04070d" }
                : i < step
                  ? { backgroundColor: C.greenLight, color: C.green }
                  : { backgroundColor: "#F3F4F6", color: C.textDim }
              }>
              {i < step ? <Check size={12} /> : <span>{i + 1}</span>}
              {s}
            </button>
            {i < STEPS.length - 1 && <div className="w-6 h-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* Step 0: Select ICP */}
      {step === 0 && (
        <div className="space-y-5">
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Nombre de la campaña</h2>
            <input
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Campaña Q2 — CFOs Argentina"
            />
          </div>

          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <div className="flex items-center gap-2 mb-4">
              <Target size={15} style={{ color: gold }} />
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Seleccionar perfil ICP</h2>
            </div>

            {icps.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: C.textDim }}>No hay perfiles ICP.</p>
                <button onClick={() => router.push("/icp")} className="text-sm font-semibold mt-2" style={{ color: gold }}>Crear uno →</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {icps.map(icp => (
                  <button
                    key={icp.id}
                    onClick={() => setSelectedIcp(icp.id)}
                    className="text-left rounded-xl border p-4 transition-all"
                    style={{
                      borderColor: selectedIcp === icp.id ? gold : C.border,
                      backgroundColor: selectedIcp === icp.id ? goldLight : "transparent",
                      boxShadow: selectedIcp === icp.id ? `0 0 0 2px ${goldLight}` : "none",
                    }}>
                    <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>{icp.profile_name}</p>
                    <div className="flex flex-wrap gap-1">
                      {[...(icp.target_industries ?? []), ...(icp.target_roles ?? [])].slice(0, 4).map(t => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>{t}</span>
                      ))}
                    </div>
                    {icp.company_size && <p className="text-xs mt-1.5" style={{ color: C.textMuted }}>{icp.company_size} empleados</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Channels */}
      {step === 1 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Seleccionar canales</h2>
          <div className="grid grid-cols-2 gap-3">
            {channelOptions.map(ch => {
              const selected = channels.includes(ch.key);
              const Icon = ch.icon;
              const disabled = ch.key === "whatsapp";
              return (
                <button
                  key={ch.key}
                  onClick={() => !disabled && toggleChannel(ch.key)}
                  disabled={disabled}
                  className="text-left rounded-xl border p-5 transition-all relative"
                  style={{
                    borderColor: selected ? ch.color : C.border,
                    backgroundColor: selected ? `${ch.color}08` : "transparent",
                    boxShadow: selected ? `0 0 0 2px ${ch.color}22` : "none",
                    opacity: disabled ? 0.4 : 1,
                  }}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: `${ch.color}15` }}>
                      <Icon size={18} style={{ color: ch.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{ch.label}</p>
                      <p className="text-xs" style={{ color: C.textMuted }}>{ch.desc}</p>
                    </div>
                  </div>
                  {selected && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: ch.color }}>
                      <Check size={12} color="#fff" />
                    </div>
                  )}
                  {disabled && (
                    <span className="absolute top-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F3F4F6", color: C.textDim }}>Próximamente</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Sequence config */}
      {step === 2 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Configurar secuencia</h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Pasos de la secuencia</label>
              <select
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={sequenceLength}
                onChange={e => setSequenceLength(Number(e.target.value))}>
                {[3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} pasos</option>)}
              </select>
              <p className="text-xs mt-1.5" style={{ color: C.textDim }}>Cuántos mensajes va a tener la secuencia</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Frecuencia entre pasos</label>
              <select
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={frequencyDays}
                onChange={e => setFrequencyDays(Number(e.target.value))}>
                {[1, 2, 3, 5, 7].map(n => <option key={n} value={n}>{n} {n === 1 ? "día" : "días"}</option>)}
              </select>
              <p className="text-xs mt-1.5" style={{ color: C.textDim }}>Tiempo entre cada mensaje</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Leads a contactar</label>
              <select
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                value={targetLeads}
                onChange={e => setTargetLeads(Number(e.target.value))}>
                {[25, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} leads</option>)}
              </select>
              <p className="text-xs mt-1.5" style={{ color: C.textDim }}>Cantidad total de prospectos</p>
            </div>
          </div>

          {/* Visual preview */}
          <div className="mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
            <p className="text-xs font-medium mb-3" style={{ color: C.textMuted }}>Preview de la secuencia</p>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {Array.from({ length: sequenceLength }, (_, i) => (
                <div key={i} className="flex items-center gap-2 shrink-0">
                  <div className="rounded-lg border px-3 py-2 text-center min-w-16" style={{ borderColor: C.border, backgroundColor: i === 0 ? goldLight : "transparent" }}>
                    <p className="text-xs font-bold" style={{ color: i === 0 ? gold : C.textBody }}>Paso {i + 1}</p>
                    <p className="text-xs mt-0.5" style={{ color: C.textDim }}>
                      {channels.map(c => channelOptions.find(o => o.key === c)?.label?.slice(0, 2)).join("+")}
                    </p>
                  </div>
                  {i < sequenceLength - 1 && (
                    <span className="text-xs shrink-0" style={{ color: C.textDim }}>{frequencyDays}d →</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Message prompts */}
      {step === 3 && (
        <div className="space-y-5">
          {Object.keys(prompts).length === 0 ? (
            <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
              <Sparkles size={28} className="mx-auto mb-3" style={{ color: gold }} />
              <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>Generar sugerencias de mensajes con AI</p>
              <p className="text-xs mb-5" style={{ color: C.textMuted }}>
                Basado en tu Company Bio e ICP, la AI va a generar un borrador de mensaje para cada paso de la secuencia.
              </p>
              <button
                onClick={generatePrompts}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity"
                style={{ backgroundColor: gold, color: "#04070d" }}>
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {generating ? "Generando…" : "Generar mensajes"}
              </button>
            </div>
          ) : (
            channels.map(ch => {
              const chConf = channelOptions.find(c => c.key === ch)!;
              const Icon = chConf.icon;
              return (
                <div key={ch} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${chConf.color}` }}>
                  <div className="px-6 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: C.border, background: `${chConf.color}08` }}>
                    <Icon size={15} style={{ color: chConf.color }} />
                    <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>{chConf.label}</h3>
                    <span className="text-xs" style={{ color: C.textMuted }}>— {prompts[ch]?.length ?? 0} pasos</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: C.border }}>
                    {(prompts[ch] ?? []).map((msg, i) => (
                      <div key={i} className="px-6 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold" style={{ color: C.textMuted }}>Paso {i + 1}</span>
                          <Pencil size={12} style={{ color: C.textDim }} />
                        </div>
                        {msg.subject !== undefined && (
                          <div className="mb-2">
                            <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Asunto</label>
                            <input
                              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                              value={msg.subject}
                              onChange={e => {
                                const updated = { ...prompts };
                                updated[ch] = [...updated[ch]];
                                updated[ch][i] = { ...updated[ch][i], subject: e.target.value };
                                setPrompts(updated);
                              }}
                            />
                          </div>
                        )}
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Mensaje</label>
                        <textarea
                          rows={ch === "email" ? 5 : 3}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                          value={msg.body}
                          onChange={e => {
                            const updated = { ...prompts };
                            updated[ch] = [...updated[ch]];
                            updated[ch][i] = { ...updated[ch][i], body: e.target.value };
                            setPrompts(updated);
                          }}
                        />
                        <p className="text-xs mt-1" style={{ color: C.textDim }}>Variables: {"{{first_name}}, {{last_name}}, {{company}}, {{role}}"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {Object.keys(prompts).length > 0 && (
            <button
              onClick={generatePrompts}
              disabled={generating}
              className="flex items-center gap-2 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ color: gold }}>
              <Sparkles size={13} /> Regenerar todos los mensajes
            </button>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Resumen de la campaña</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Nombre</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{name}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Perfil ICP</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{icps.find(i => i.id === selectedIcp)?.profile_name ?? "—"}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Canales</p>
                <div className="flex gap-2 mt-1">
                  {channels.map(ch => {
                    const conf = channelOptions.find(c => c.key === ch)!;
                    const Icon = conf.icon;
                    return (
                      <span key={ch} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md" style={{ backgroundColor: `${conf.color}12`, color: conf.color }}>
                        <Icon size={12} /> {conf.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Secuencia</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{sequenceLength} pasos cada {frequencyDays} días — {targetLeads} leads</p>
              </div>
            </div>

            <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.yellowLight }}>
              <div className="flex items-start gap-3">
                <Building2 size={16} className="mt-0.5 shrink-0" style={{ color: C.yellow }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: C.textPrimary }}>Revisión interna requerida</p>
                  <p className="text-xs mt-0.5" style={{ color: C.textBody }}>
                    Al enviar, el equipo SWL revisará la campaña antes de activarla. Recibirás una notificación cuando esté aprobada.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
        <button
          onClick={() => setStep(s => s - 1)}
          disabled={step === 0}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-30"
          style={{ color: C.textBody, backgroundColor: "#F3F4F6" }}>
          <ArrowLeft size={15} /> Anterior
        </button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext()}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            Siguiente <ArrowRight size={15} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.green, color: "#fff" }}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {submitting ? "Enviando…" : "Enviar para revisión"}
          </button>
        )}
      </div>
    </div>
  );
}
