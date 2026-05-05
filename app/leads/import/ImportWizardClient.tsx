"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import {
  Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2,
  Lock, ChevronRight, X, Sparkles,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const CANONICAL_COLUMNS = [
  "primary_first_name", "primary_last_name", "primary_personal_email", "primary_work_email",
  "primary_phone", "primary_secondary_phone", "primary_linkedin_url", "primary_instagram",
  "primary_facebook", "primary_photo_url", "primary_headline", "primary_title_role",
  "primary_career", "primary_seniority", "primary_email_status",
  "company_name", "company_website", "company_address_1", "company_address_2", "company_cp",
  "company_city", "company_state", "company_country", "company_phone", "company_email",
  "company_linkedin", "company_instagram", "twitter_url", "facebook_url",
  "company_industry", "company_sub_industry", "keywords", "employees", "annual_revenue",
  "organization_tagline", "organization_description", "organization_short_desc",
  "organization_logo_url", "organization_technologies", "similar_organization",
  "google_reviews_rating",
  "_fullname", "_location", "_skip",
];

type ParsedSheet = {
  fileName: string;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  rows: Array<Record<string, string>>;
};

type Mapping = { source: string; target: string };
type MappingResult = { source_tool: string; mappings: Mapping[] };

type Step = "upload" | "map" | "confirm" | "done";

export default function ImportWizardClient({ willEncrypt }: { willEncrypt: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping[]>([]);
  const [sourceTool, setSourceTool] = useState<string>("");
  const [mappingLoading, setMappingLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/leads/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      setParsed(data);

      // Kick off AI mapping immediately.
      setMappingLoading(true);
      const mapRes = await fetch("/api/leads/import/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: data.fileName,
          sourceHeaders: data.headers,
          sampleRows: data.sampleRows,
        }),
      });
      const mapData: MappingResult = await mapRes.json();
      if (!mapRes.ok) throw new Error((mapData as { error?: string }).error ?? "AI mapping failed");
      // Pad with empty mapping for any header AI didn't return so the UI shows them.
      const aiBySource = new Map(mapData.mappings.map(m => [m.source, m.target]));
      const completeMapping: Mapping[] = data.headers.map((h: string) => ({
        source: h,
        target: aiBySource.get(h) ?? "_skip",
      }));
      setMapping(completeMapping);
      setSourceTool(mapData.source_tool);
      setStep("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setParsing(false);
      setMappingLoading(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const updateMapping = (idx: number, target: string) => {
    setMapping(m => m.map((row, i) => (i === idx ? { ...row, target } : row)));
  };

  const recognisedCount = useMemo(
    () => mapping.filter(m => m.target && m.target !== "_skip" && !m.target.startsWith("_extra:")).length,
    [mapping],
  );
  const extraCount = useMemo(
    () => mapping.filter(m => m.target.startsWith("_extra:")).length,
    [mapping],
  );

  async function handleCommit() {
    if (!parsed) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: parsed.fileName,
          rows: parsed.rows,
          mapping: { source_tool: sourceTool, mappings: mapping.filter(m => m.target && m.target !== "_skip") },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult({ inserted: data.inserted, skipped: data.skipped });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setMapping([]);
    setSourceTool("");
    setError(null);
    setResult(null);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Stepper step={step} />

      {error && (
        <div className="rounded-xl border px-4 py-3 mb-4 flex items-start gap-3" style={{ borderColor: `${C.red}40`, backgroundColor: C.redLight }}>
          <AlertTriangle size={16} style={{ color: C.red, flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-xs font-bold" style={{ color: C.red }}>Something went wrong</p>
            <p className="text-xs" style={{ color: C.red }}>{error}</p>
          </div>
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} style={{ color: C.red }} /></button>
        </div>
      )}

      {step === "upload" && (
        <UploadStep
          file={file}
          parsing={parsing}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDrop={onDrop}
          onFile={handleFile}
          willEncrypt={willEncrypt}
        />
      )}

      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          mapping={mapping}
          sourceTool={sourceTool}
          mappingLoading={mappingLoading}
          recognisedCount={recognisedCount}
          extraCount={extraCount}
          onUpdate={updateMapping}
          onBack={reset}
          onContinue={() => setStep("confirm")}
        />
      )}

      {step === "confirm" && parsed && (
        <ConfirmStep
          parsed={parsed}
          mapping={mapping}
          sourceTool={sourceTool}
          recognisedCount={recognisedCount}
          extraCount={extraCount}
          willEncrypt={willEncrypt}
          committing={committing}
          onBack={() => setStep("map")}
          onCommit={handleCommit}
        />
      )}

      {step === "done" && result && (
        <DoneStep result={result} willEncrypt={willEncrypt} onAnother={reset} onBack={() => router.push("/leads")} />
      )}
    </div>
  );
}

// ── steps ─────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map columns" },
    { key: "confirm", label: "Confirm" },
    { key: "done", label: "Done" },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{
                backgroundColor: done ? C.green : active ? gold : C.surface,
                color: done || active ? "#fff" : C.textMuted,
              }}
            >
              {done ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            <span className="text-xs font-semibold" style={{ color: active ? C.textPrimary : C.textMuted }}>
              {s.label}
            </span>
            {i < steps.length - 1 && <ChevronRight size={14} style={{ color: C.textDim }} />}
          </div>
        );
      })}
    </div>
  );
}

function UploadStep({
  file, parsing, dragOver, setDragOver, onDrop, onFile, willEncrypt,
}: {
  file: File | null;
  parsing: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFile: (f: File) => void;
  willEncrypt: boolean;
}) {
  return (
    <div className="rounded-2xl border p-8" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <label
        className="block w-full cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors"
        style={{
          borderColor: dragOver ? gold : C.border,
          backgroundColor: dragOver ? `color-mix(in srgb, ${gold} 5%, transparent)` : C.bg,
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.tsv,.txt"
          className="sr-only"
          disabled={parsing}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))` }}>
          {parsing ? <Loader2 size={22} className="animate-spin" style={{ color: "#fff" }} /> : <Upload size={22} style={{ color: "#fff" }} />}
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>
          {parsing ? `Parsing ${file?.name ?? "file"}…` : "Drop your file here or click to browse"}
        </p>
        <p className="text-xs" style={{ color: C.textMuted }}>
          CSV, XLSX, XLS, TSV — up to 10MB · 50,000 rows
        </p>
      </label>

      <div className="mt-6 rounded-xl border p-4 flex items-start gap-3" style={{ borderColor: willEncrypt ? `${C.green}30` : `${C.orange}30`, backgroundColor: willEncrypt ? C.greenLight : C.orangeLight }}>
        {willEncrypt
          ? <Lock size={16} style={{ color: C.green, flexShrink: 0, marginTop: 2 }} />
          : <AlertTriangle size={16} style={{ color: C.orange, flexShrink: 0, marginTop: 2 }} />}
        <div>
          <p className="text-xs font-bold" style={{ color: willEncrypt ? C.green : C.orange }}>
            {willEncrypt ? "Encrypted at rest" : "SWL admin import (plain)"}
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: C.textBody }}>
            {willEncrypt
              ? "Your leads will be encrypted with AES-256. SWL operators won't see them in admin views. Every read is logged."
              : "Leads imported through this admin path are stored unencrypted. Use the tenant flow for client-private imports."}
          </p>
        </div>
      </div>
    </div>
  );
}

function MapStep({
  parsed, mapping, sourceTool, mappingLoading, recognisedCount, extraCount,
  onUpdate, onBack, onContinue,
}: {
  parsed: ParsedSheet;
  mapping: Mapping[];
  sourceTool: string;
  mappingLoading: boolean;
  recognisedCount: number;
  extraCount: number;
  onUpdate: (idx: number, target: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4 flex items-center gap-4" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <FileSpreadsheet size={20} style={{ color: gold, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{parsed.fileName}</p>
          <p className="text-[11px]" style={{ color: C.textMuted }}>
            {parsed.totalRows.toLocaleString()} rows · {parsed.headers.length} columns
            {sourceTool && <> · detected as <span style={{ color: gold, fontWeight: 600 }}>{sourceTool}</span></>}
          </p>
        </div>
        {mappingLoading && (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.blue }}>
            <Sparkles size={12} className="animate-pulse" /> Mapping with AI…
          </div>
        )}
      </div>

      <div className="rounded-2xl border" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: C.border }}>
          <p className="text-xs font-bold" style={{ color: C.textPrimary }}>Column mapping</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: C.greenLight, color: C.green }}>
            {recognisedCount} matched
          </span>
          {extraCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: C.blueLight, color: C.blue }}>
              {extraCount} as extras
            </span>
          )}
          <span className="text-[10px]" style={{ color: C.textMuted }}>Edit any row to override the AI&apos;s suggestion</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg }}>
              <tr style={{ color: C.textMuted }}>
                <th className="text-left px-4 py-2 font-semibold">Your column</th>
                <th className="text-left px-4 py-2 font-semibold">Sample</th>
                <th className="text-left px-4 py-2 font-semibold">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((row, i) => {
                const sample = parsed.sampleRows[0]?.[row.source] ?? "";
                const isExtra = row.target.startsWith("_extra:");
                return (
                  <tr key={row.source} className="border-t" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2 font-semibold" style={{ color: C.textPrimary }}>{row.source}</td>
                    <td className="px-4 py-2 truncate max-w-[240px]" style={{ color: C.textMuted }}>{sample.slice(0, 60)}</td>
                    <td className="px-4 py-2">
                      <select
                        value={isExtra ? "_extra" : row.target}
                        onChange={(e) => {
                          const v = e.target.value;
                          onUpdate(i, v === "_extra" ? `_extra:${row.source}` : v);
                        }}
                        className="rounded-md px-2 py-1 text-xs focus:outline-none"
                        style={{ backgroundColor: C.bg, color: C.textPrimary, border: `1px solid ${C.border}` }}
                      >
                        <option value="_skip">— Skip —</option>
                        <option value="_extra">Custom field (enrichment)</option>
                        {CANONICAL_COLUMNS.filter(c => !c.startsWith("_")).map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                        <option value="_fullname">Full name (split)</option>
                        <option value="_location">Location (split city/state/country)</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={recognisedCount === 0}
          className="rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          Continue → Confirm
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  parsed, mapping, sourceTool, recognisedCount, extraCount, willEncrypt, committing, onBack, onCommit,
}: {
  parsed: ParsedSheet;
  mapping: Mapping[];
  sourceTool: string;
  recognisedCount: number;
  extraCount: number;
  willEncrypt: boolean;
  committing: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  void mapping;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-6" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <p className="text-sm font-bold mb-3" style={{ color: C.textPrimary }}>Ready to import</p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Rows" value={parsed.totalRows.toLocaleString()} />
          <Stat label="Mapped" value={`${recognisedCount} canonical`} />
          <Stat label="Custom fields" value={`${extraCount} extras`} />
        </div>
        {sourceTool && (
          <p className="text-[11px] mt-4" style={{ color: C.textMuted }}>
            Detected source: <span style={{ color: gold, fontWeight: 600 }}>{sourceTool}</span>
          </p>
        )}
      </div>

      <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: willEncrypt ? `${C.green}30` : `${C.orange}30`, backgroundColor: willEncrypt ? C.greenLight : C.orangeLight }}>
        {willEncrypt
          ? <Lock size={16} style={{ color: C.green, flexShrink: 0, marginTop: 2 }} />
          : <AlertTriangle size={16} style={{ color: C.orange, flexShrink: 0, marginTop: 2 }} />}
        <div>
          <p className="text-xs font-bold mb-1" style={{ color: willEncrypt ? C.green : C.orange }}>
            {willEncrypt ? "Will be encrypted at rest" : "Will be stored unencrypted"}
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: C.textBody }}>
            {willEncrypt
              ? "These leads will be marked source=client and stored encrypted. SWL admin views will see redacted PII for these leads."
              : "These leads will be marked source=swl and stored in plain text (legacy SWL flow)."}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onBack} disabled={committing} className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ backgroundColor: C.surface, color: C.textBody }}>
          Back
        </button>
        <button
          onClick={onCommit}
          disabled={committing}
          className="flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-bold disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          {committing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {committing ? "Importing…" : `Import ${parsed.totalRows.toLocaleString()} leads`}
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  result, willEncrypt, onAnother, onBack,
}: {
  result: { inserted: number; skipped: number };
  willEncrypt: boolean;
  onAnother: () => void;
  onBack: () => void;
}) {
  return (
    <div className="rounded-2xl border p-10 text-center" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: C.greenLight }}>
        <CheckCircle2 size={28} style={{ color: C.green }} />
      </div>
      <p className="text-lg font-bold mb-1" style={{ color: C.textPrimary }}>
        Imported {result.inserted.toLocaleString()} leads
      </p>
      {result.skipped > 0 && (
        <p className="text-xs mb-3" style={{ color: C.textMuted }}>
          {result.skipped} rows skipped (missing name and contact info)
        </p>
      )}
      {willEncrypt && (
        <p className="text-xs mb-6 flex items-center justify-center gap-1.5" style={{ color: C.green }}>
          <Lock size={11} /> Stored encrypted at rest
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
        <button onClick={onAnother} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>
          Import another file
        </button>
        <button
          onClick={onBack}
          className="rounded-lg px-5 py-2 text-sm font-semibold"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          View leads →
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-base font-bold" style={{ color: C.textPrimary }}>{value}</p>
    </div>
  );
}
