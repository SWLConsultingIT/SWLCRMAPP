"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2,
  Lock, ChevronRight, X, Sparkles, Target, Search, EyeOff, Database, Layers,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

// Canonical lead columns the wizard can map to. Kept in three buckets so
// the Map step can group them — Person / Company / Org enrichment — and
// the operator finds the right target faster than scrolling 40 options.
const CANONICAL_GROUPS: { label: string; targets: string[] }[] = [
  {
    label: "Person",
    targets: [
      "primary_first_name", "primary_last_name", "primary_personal_email", "primary_work_email",
      "primary_phone", "primary_secondary_phone", "primary_linkedin_url", "primary_instagram",
      "primary_facebook", "primary_photo_url", "primary_headline", "primary_title_role",
      "primary_career", "primary_seniority", "primary_email_status",
    ],
  },
  {
    label: "Company",
    targets: [
      "company_name", "company_website", "company_address_1", "company_address_2", "company_cp",
      "company_city", "company_state", "company_country", "company_phone", "company_email",
      "company_linkedin", "company_instagram", "twitter_url", "facebook_url",
      "company_industry", "company_sub_industry", "employees", "annual_revenue",
    ],
  },
  {
    label: "Org enrichment",
    targets: [
      "keywords", "organization_tagline", "organization_description", "organization_short_desc",
      "organization_logo_url", "organization_technologies", "similar_organization",
      "google_reviews_rating",
    ],
  },
];

const ALL_CANONICAL = CANONICAL_GROUPS.flatMap(g => g.targets);

type ParsedSheet = {
  fileName: string;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  rows: Array<Record<string, string>>;
};

type Mapping = { source: string; target: string };
type MappingResult = { source_tool: string; mappings: Mapping[] };

type Step = "icp" | "upload" | "map" | "confirm" | "done";

type IcpRow = {
  id: string;
  profile_name: string;
  status: string | null;
  target_industries?: string[] | null;
  target_roles?: string[] | null;
};

type DryRunOutcome = {
  rowIndex: number;
  status: "insert" | "update" | "skipped_duplicate" | "skipped_no_data";
  existingLeadId?: string | null;
  reason?: string;
  display?: { name: string; company: string; linkedin?: string | null };
};

type DryRunResponse = {
  counts: { insert: number; update: number; skippedDuplicate: number; skippedNoData: number };
  outcomes: DryRunOutcome[];
};

type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  encrypted: boolean;
  rowResults?: Array<{
    rowIndex: number;
    status: "inserted" | "updated" | "skipped_duplicate" | "skipped_no_data" | "error";
    leadId?: string | null;
    reason?: string;
  }>;
};

export default function ImportWizardClient({ isSwlAdmin }: { isSwlAdmin: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("icp");

  // ── ICP selection (step 1) ──────────────────────────────────────────
  const [icps, setIcps] = useState<IcpRow[] | null>(null);
  const [icpLoading, setIcpLoading] = useState(true);
  const [selectedIcpId, setSelectedIcpId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/icp")
      .then(r => r.ok ? r.json() : { icps: [] })
      .then(d => { if (!cancelled) setIcps(d.icps ?? []); })
      .catch(() => { if (!cancelled) setIcps([]); })
      .finally(() => { if (!cancelled) setIcpLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Upload + parse + AI map (steps 2 + 3 prep) ──────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping[]>([]);
  const [sourceTool, setSourceTool] = useState<string>("");
  const [mappingLoading, setMappingLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ── Dry-run preview (step 4 prep) ───────────────────────────────────
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  // ── Commit + done state ─────────────────────────────────────────────
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Encryption toggle: only SWL admin sees it. Other roles always encrypt.
  const [encryptOverride, setEncryptOverride] = useState(false);
  const willEncrypt = isSwlAdmin ? encryptOverride : true;

  const selectedIcp = useMemo(
    () => icps?.find(i => i.id === selectedIcpId) ?? null,
    [icps, selectedIcpId],
  );

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError(null);
    setParsing(true);
    setDryRun(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/leads/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      setParsed(data);

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
      if (!mapRes.ok) throw new Error((mapData as { error?: string }).error ?? "Mapping failed");
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

  const updateMapping = (source: string, target: string) => {
    setMapping(m => m.map(row => (row.source === source ? { ...row, target } : row)));
  };

  // Categorize each mapping into canonical / enrichment / skip — used by
  // both the Map step's grouped table and the stats strip.
  const buckets = useMemo(() => {
    const canonical: Mapping[] = [];
    const enrichment: Mapping[] = [];
    const skipped: Mapping[] = [];
    for (const m of mapping) {
      if (!m.target || m.target === "_skip") skipped.push(m);
      else if (m.target.startsWith("_extra:")) enrichment.push(m);
      else canonical.push(m);
    }
    return { canonical, enrichment, skipped };
  }, [mapping]);

  // Trigger dry-run when the user moves from Map → Confirm so the
  // preview tile renders with real numbers.
  async function goToConfirm() {
    if (!parsed) return;
    setDryRunLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/import/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: parsed.rows,
          mapping: { source_tool: sourceTool, mappings: mapping.filter(m => m.target && m.target !== "_skip") },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setDryRun(data);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleCommit() {
    if (!parsed || !selectedIcpId) return;
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
          icpProfileId: selectedIcpId,
          encrypt: willEncrypt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult({
        inserted: data.inserted ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? 0,
        encrypted: data.encrypted ?? willEncrypt,
        rowResults: data.rowResults,
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setMapping([]);
    setSourceTool("");
    setDryRun(null);
    setError(null);
    setResult(null);
  }

  function resetToIcp() {
    resetToUpload();
    setSelectedIcpId(null);
    setStep("icp");
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

      {step === "icp" && (
        <IcpPickStep
          icps={icps}
          loading={icpLoading}
          selectedIcpId={selectedIcpId}
          setSelectedIcpId={setSelectedIcpId}
          onContinue={() => setStep("upload")}
        />
      )}

      {step === "upload" && selectedIcp && (
        <UploadStep
          file={file}
          parsing={parsing}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDrop={onDrop}
          onFile={handleFile}
          willEncrypt={willEncrypt}
          icp={selectedIcp}
          onBack={resetToIcp}
        />
      )}

      {step === "map" && parsed && selectedIcp && (
        <MapStep
          parsed={parsed}
          mapping={mapping}
          buckets={buckets}
          sourceTool={sourceTool}
          mappingLoading={mappingLoading}
          icp={selectedIcp}
          dryRunLoading={dryRunLoading}
          onUpdate={updateMapping}
          onBack={resetToUpload}
          onContinue={goToConfirm}
        />
      )}

      {step === "confirm" && parsed && selectedIcp && dryRun && (
        <ConfirmStep
          parsed={parsed}
          icp={selectedIcp}
          dryRun={dryRun}
          willEncrypt={willEncrypt}
          isSwlAdmin={isSwlAdmin}
          encryptOverride={encryptOverride}
          setEncryptOverride={setEncryptOverride}
          committing={committing}
          onBack={() => setStep("map")}
          onCommit={handleCommit}
        />
      )}

      {step === "done" && result && (
        <DoneStep result={result} onAnother={resetToIcp} onView={() => router.push("/leads")} />
      )}
    </div>
  );
}

// ── steps ─────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "icp",     label: "ICP" },
    { key: "upload",  label: "Upload" },
    { key: "map",     label: "Map columns" },
    { key: "confirm", label: "Confirm" },
    { key: "done",    label: "Done" },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
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

// ── Step 1: ICP pick ──────────────────────────────────────────────────────

function IcpPickStep({
  icps, loading, selectedIcpId, setSelectedIcpId, onContinue,
}: {
  icps: IcpRow[] | null;
  loading: boolean;
  selectedIcpId: string | null;
  setSelectedIcpId: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="rounded-2xl border p-6" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1505" }}>
          <Target size={16} />
        </span>
        <div>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>Pick the ICP these leads belong to</p>
          <p className="text-[11px]" style={{ color: C.textMuted }}>
            Every lead lands attached to one ICP so a campaign can pull from it (one-ICP-per-campaign LAW).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs" style={{ color: C.textMuted }}>
          <Loader2 size={14} className="animate-spin" /> Loading ICPs…
        </div>
      ) : !icps || icps.length === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>No ICPs in this tenant yet</p>
          <p className="text-xs mb-4" style={{ color: C.textMuted }}>
            Create one first so the imported leads have somewhere to live.
          </p>
          <Link
            href="/icp"
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1505" }}
          >
            Go to ICPs →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {icps.map(icp => {
            const isActive = selectedIcpId === icp.id;
            const industries = icp.target_industries ?? [];
            const roles = icp.target_roles ?? [];
            return (
              <button
                key={icp.id}
                type="button"
                onClick={() => setSelectedIcpId(icp.id)}
                className="rounded-xl border px-4 py-3.5 text-left transition-all hover:shadow-md"
                style={{
                  borderColor: isActive ? gold : C.border,
                  borderWidth: isActive ? 2 : 1,
                  backgroundColor: isActive ? `color-mix(in srgb, ${gold} 6%, ${C.card})` : C.card,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[13.5px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {icp.profile_name}
                  </p>
                  {isActive && <CheckCircle2 size={16} style={{ color: gold }} />}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {industries.slice(0, 3).map((ind, idx) => (
                    <span key={idx} className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.blueLight, color: C.blue }}>{ind}</span>
                  ))}
                  {roles.slice(0, 2).map((r, idx) => (
                    <span key={`r-${idx}`} className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textBody }}>{r}</span>
                  ))}
                </div>
                <p className="text-[10px]" style={{ color: C.textDim }}>
                  Status: <span style={{ color: icp.status === "approved" ? C.green : C.textBody }}>{icp.status ?? "—"}</span>
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onContinue}
          disabled={!selectedIcpId}
          className="rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          Continue → Upload
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Upload ────────────────────────────────────────────────────────

function UploadStep({
  file, parsing, dragOver, setDragOver, onDrop, onFile, willEncrypt, icp, onBack,
}: {
  file: File | null;
  parsing: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFile: (f: File) => void;
  willEncrypt: boolean;
  icp: IcpRow;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <IcpChip icp={icp} onChange={onBack} />

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
    </div>
  );
}

// ── Step 3: Map columns ───────────────────────────────────────────────────

function MapStep({
  parsed, mapping, buckets, sourceTool, mappingLoading, icp, dryRunLoading,
  onUpdate, onBack, onContinue,
}: {
  parsed: ParsedSheet;
  mapping: Mapping[];
  buckets: { canonical: Mapping[]; enrichment: Mapping[]; skipped: Mapping[] };
  sourceTool: string;
  mappingLoading: boolean;
  icp: IcpRow;
  dryRunLoading: boolean;
  onUpdate: (source: string, target: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeBucket, setActiveBucket] = useState<"all" | "canonical" | "enrichment" | "skipped">("all");

  // Apply the filter chips + search to the table view (the underlying
  // `mapping` array stays intact so toggling a row in or out of a bucket
  // updates the counts but keeps the source order stable).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mapping
      .map((m, originalIdx) => ({ ...m, originalIdx, _bucket: bucketOf(m) }))
      .filter(m => {
        if (activeBucket !== "all" && m._bucket !== activeBucket) return false;
        if (!q) return true;
        return m.source.toLowerCase().includes(q) || m.target.toLowerCase().includes(q);
      });
  }, [mapping, search, activeBucket]);

  return (
    <div className="space-y-4">
      <IcpChip icp={icp} />

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

      {/* Three-bucket explainer — answers "what does '3 as extras' mean?" */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BucketTile
          icon={Database}
          label="Canonical fields"
          count={buckets.canonical.length}
          color={C.green}
          description="Mapped 1:1 to CRM columns — searchable, filterable, used by AI generator."
          active={activeBucket === "canonical"}
          onClick={() => setActiveBucket(activeBucket === "canonical" ? "all" : "canonical")}
        />
        <BucketTile
          icon={Layers}
          label="Enrichment"
          count={buckets.enrichment.length}
          color={C.blue}
          description="Custom columns saved in the lead's enrichment JSONB — visible on the lead detail."
          active={activeBucket === "enrichment"}
          onClick={() => setActiveBucket(activeBucket === "enrichment" ? "all" : "enrichment")}
        />
        <BucketTile
          icon={EyeOff}
          label="Skipped"
          count={buckets.skipped.length}
          color={C.textMuted}
          description="Won't be imported. Use for tracking columns (Email Open, Stage…) or empty ones."
          active={activeBucket === "skipped"}
          onClick={() => setActiveBucket(activeBucket === "skipped" ? "all" : "skipped")}
        />
      </div>

      {/* Search + table */}
      <div className="rounded-2xl border" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: C.border }}>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by source header or target field…"
              className="w-full pl-7 pr-3 py-1.5 text-[12px] rounded-lg border outline-none"
              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            />
          </div>
          <p className="text-[10.5px]" style={{ color: C.textMuted }}>
            Showing {visible.length} of {mapping.length} · click <strong>Maps to</strong> to override.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10" style={{ backgroundColor: C.bg }}>
              <tr style={{ color: C.textMuted }}>
                <th className="text-left px-4 py-2 font-semibold w-8" />
                <th className="text-left px-4 py-2 font-semibold">Your column</th>
                <th className="text-left px-4 py-2 font-semibold">Sample value</th>
                <th className="text-left px-4 py-2 font-semibold">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const sample = parsed.sampleRows[0]?.[row.source] ?? "";
                const bucket = row._bucket;
                const accent = bucket === "canonical" ? C.green : bucket === "enrichment" ? C.blue : C.textMuted;
                return (
                  <tr key={row.source} className="border-t" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5">
                      <span className="inline-block w-1.5 h-6 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
                    </td>
                    <td className="px-4 py-2.5 font-semibold align-top" style={{ color: C.textPrimary }}>
                      {row.source}
                      <p className="text-[9.5px] font-bold uppercase tracking-wider mt-0.5" style={{ color: accent }}>
                        {bucket === "canonical" ? "Canonical" : bucket === "enrichment" ? "Enrichment" : "Skipped"}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className="block truncate max-w-[260px] text-[11.5px]" style={{ color: C.textMuted }} title={sample}>
                        {sample ? sample.slice(0, 80) : <em style={{ color: C.textDim }}>(empty)</em>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <TargetSelect
                        value={row.target}
                        sourceHeader={row.source}
                        onChange={(v) => onUpdate(row.source, v)}
                      />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-[12px]" style={{ color: C.textMuted }}>
                  No columns match your search / filter.
                </td></tr>
              )}
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
          disabled={buckets.canonical.length === 0 || dryRunLoading}
          className="rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-2"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          {dryRunLoading ? <Loader2 size={14} className="animate-spin" /> : null}
          {dryRunLoading ? "Building preview…" : "Continue → Preview"}
        </button>
      </div>
    </div>
  );
}

function bucketOf(m: Mapping): "canonical" | "enrichment" | "skipped" {
  if (!m.target || m.target === "_skip") return "skipped";
  if (m.target.startsWith("_extra:")) return "enrichment";
  return "canonical";
}

function BucketTile({
  icon: Icon, label, count, color, description, active, onClick,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  count: number;
  color: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border p-3 text-left transition-shadow hover:shadow-md"
      style={{
        borderColor: active ? color : C.border,
        borderWidth: active ? 2 : 1,
        backgroundColor: active ? `color-mix(in srgb, ${color} 6%, ${C.card})` : C.card,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon size={11} />
        </span>
        <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
        <span className="ml-auto text-[14px] font-bold tabular-nums" style={{ color }}>{count}</span>
      </div>
      <p className="text-[10.5px] leading-snug" style={{ color: C.textMuted }}>{description}</p>
    </button>
  );
}

function TargetSelect({
  value, sourceHeader, onChange,
}: {
  value: string;
  sourceHeader: string;
  onChange: (v: string) => void;
}) {
  const isExtra = value.startsWith("_extra:");
  return (
    <select
      value={isExtra ? "_extra" : value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "_extra" ? `_extra:${sourceHeader}` : v);
      }}
      className="rounded-md px-2 py-1 text-xs focus:outline-none w-full max-w-[280px]"
      style={{ backgroundColor: C.bg, color: C.textPrimary, border: `1px solid ${C.border}` }}
    >
      <option value="_skip">— Skip (don&apos;t import) —</option>
      <option value="_extra">Custom field → enrichment</option>
      <option disabled>──────────</option>
      {CANONICAL_GROUPS.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.targets.map(t => <option key={t} value={t}>{t}</option>)}
        </optgroup>
      ))}
      <option disabled>──────────</option>
      <option value="_fullname">Full name (split into first + last)</option>
      <option value="_location">Location (split into city / state / country)</option>
    </select>
  );
}

// ── Step 4: Confirm with dedup preview ───────────────────────────────────

function ConfirmStep({
  parsed, icp, dryRun, willEncrypt, isSwlAdmin, encryptOverride, setEncryptOverride, committing, onBack, onCommit,
}: {
  parsed: ParsedSheet;
  icp: IcpRow;
  dryRun: DryRunResponse;
  willEncrypt: boolean;
  isSwlAdmin: boolean;
  encryptOverride: boolean;
  setEncryptOverride: (v: boolean) => void;
  committing: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const dupRows = dryRun.outcomes.filter(o => o.status === "skipped_duplicate");
  const noDataRows = dryRun.outcomes.filter(o => o.status === "skipped_no_data");

  return (
    <div className="space-y-4">
      <IcpChip icp={icp} />

      {/* Big preview tile — 4 stats so the operator sees the real numbers
          before pressing Import. Insert / Update / Duplicates / No-data
          maps 1:1 to what /commit will produce. */}
      <div className="rounded-2xl border p-5" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <p className="text-sm font-bold mb-3" style={{ color: C.textPrimary }}>
          Import preview · {parsed.totalRows.toLocaleString()} rows
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PreviewTile label="Will insert"        value={dryRun.counts.insert}            color={C.green}    icon={CheckCircle2} accent />
          <PreviewTile label="Will update"        value={dryRun.counts.update}            color={C.blue}     icon={Database} />
          <PreviewTile label="Duplicates skipped" value={dryRun.counts.skippedDuplicate}  color="#D97706"    icon={AlertTriangle} />
          <PreviewTile label="No-data skipped"    value={dryRun.counts.skippedNoData}     color={C.textMuted} icon={EyeOff} />
        </div>
      </div>

      {/* Duplicate detail — collapsed list so the operator can review
          which leads are being skipped. Updates have their own list so
          we don't conflate "already exists, will patch" with "already
          exists in a running campaign, leave alone". */}
      {dupRows.length > 0 && (
        <DupSection title={`Duplicates that won't be imported (${dupRows.length})`} rows={dupRows} color="#D97706" />
      )}
      {noDataRows.length > 0 && (
        <DupSection title={`Rows with no name + no contact info (${noDataRows.length})`} rows={noDataRows} color={C.textMuted} />
      )}

      {/* Encryption toggle (SWL admin only) */}
      {isSwlAdmin && (
        <div className="rounded-2xl border p-4" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>Encrypt these leads at rest?</p>
              <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>
                Default: <strong>off</strong> — leads stored as <code style={{ fontFamily: "monospace" }}>source=swl</code> plaintext.
                Turn on only when uploading on behalf of a client that asked for at-rest encryption.
              </p>
            </div>
            <button
              type="button" role="switch" aria-checked={encryptOverride}
              onClick={() => setEncryptOverride(!encryptOverride)}
              className="shrink-0 inline-flex items-center rounded-full transition-colors"
              style={{ width: 44, height: 24, backgroundColor: encryptOverride ? C.green : C.border, padding: 2 }}
            >
              <span className="inline-block rounded-full transition-transform"
                style={{
                  width: 20, height: 20, backgroundColor: "#fff",
                  transform: encryptOverride ? "translateX(20px)" : "translateX(0)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
            </button>
          </div>
        </div>
      )}

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
              ? "These leads will be marked source=client and stored encrypted. SWL admin views will see redacted PII."
              : "These leads will be marked source=swl and stored in plain text."}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onBack} disabled={committing} className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ backgroundColor: C.surface, color: C.textBody }}>
          Back to mapping
        </button>
        <button
          onClick={onCommit}
          disabled={committing || (dryRun.counts.insert === 0 && dryRun.counts.update === 0)}
          className="flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-bold disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          {committing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {committing
            ? "Importing…"
            : `Import ${(dryRun.counts.insert + dryRun.counts.update).toLocaleString()} leads`}
        </button>
      </div>
    </div>
  );
}

function PreviewTile({
  label, value, color, icon: Icon, accent,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3" style={{
      borderColor: accent ? color : C.border,
      borderWidth: accent ? 2 : 1,
      backgroundColor: accent ? `color-mix(in srgb, ${color} 6%, ${C.bg})` : C.bg,
    }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
      </div>
      <p className="text-[22px] font-bold tabular-nums leading-none" style={{ color: value > 0 ? color : C.textDim, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function DupSection({ title, rows, color }: { title: string; rows: DryRunOutcome[]; color: string }) {
  return (
    <details className="rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${color} 28%, ${C.border})`, backgroundColor: C.card }}>
      <summary className="px-4 py-3 cursor-pointer text-xs font-semibold flex items-center gap-2" style={{ color }}>
        <AlertTriangle size={12} /> {title} <span style={{ color: C.textMuted, fontWeight: 400 }}>· click to view</span>
      </summary>
      <div className="max-h-72 overflow-y-auto border-t" style={{ borderColor: C.border }}>
        <table className="w-full text-xs" style={{ minWidth: 600 }}>
          <thead style={{ position: "sticky", top: 0, backgroundColor: C.surface }}>
            <tr>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted, width: 60 }}>Row</th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted }}>Lead</th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted }}>Company</th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map(r => (
              <tr key={r.rowIndex} style={{ borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2 tabular-nums" style={{ color: C.textBody }}>{r.rowIndex}</td>
                <td className="px-3 py-2" style={{ color: C.textPrimary }}>{r.display?.name ?? "—"}</td>
                <td className="px-3 py-2" style={{ color: C.textMuted }}>{r.display?.company ?? "—"}</td>
                <td className="px-3 py-2" style={{ color: C.textMuted }}>{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 200 && (
          <p className="px-4 py-2 text-[11px] text-center" style={{ color: C.textMuted, backgroundColor: C.surface }}>
            Showing first 200 of {rows.length} rows.
          </p>
        )}
      </div>
    </details>
  );
}

// ── Step 5: Done ──────────────────────────────────────────────────────────

function DoneStep({
  result, onAnother, onView,
}: {
  result: ImportResult;
  onAnother: () => void;
  onView: () => void;
}) {
  const total = result.inserted + result.updated + result.skipped + result.errors;
  const hasIssues = result.errors > 0 || result.skipped > 0;
  return (
    <div className="rounded-2xl border p-8" style={{ borderColor: C.border, backgroundColor: C.card }}>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: result.errors === 0 ? C.greenLight : C.redLight }}>
          {result.errors === 0
            ? <CheckCircle2 size={26} style={{ color: C.green }} />
            : <AlertTriangle size={26} style={{ color: C.red }} />}
        </div>
        <div>
          <p className="text-lg font-bold" style={{ color: C.textPrimary }}>
            {result.inserted.toLocaleString()} leads inserted
          </p>
          <p className="text-xs" style={{ color: C.textMuted }}>
            of {total.toLocaleString()} rows processed
            {result.encrypted ? " · stored encrypted" : " · stored plaintext"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <BreakdownTile label="Inserted" value={result.inserted} color={C.green} />
        <BreakdownTile label="Updated" value={result.updated} color={C.blue} />
        <BreakdownTile label="Skipped" value={result.skipped} color="#D97706" />
        <BreakdownTile label="Errors" value={result.errors} color={C.red} />
      </div>

      {hasIssues && result.rowResults && result.rowResults.length > 0 && (
        <details className="mb-6 rounded-xl border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <summary className="px-4 py-3 cursor-pointer text-xs font-semibold flex items-center gap-2" style={{ color: C.textBody }}>
            Show row-level details ({result.rowResults.filter(r => r.status !== "inserted").length} non-insert outcomes)
          </summary>
          <div className="max-h-72 overflow-y-auto border-t" style={{ borderColor: C.border }}>
            <table className="w-full text-xs">
              <thead style={{ position: "sticky", top: 0, backgroundColor: C.surface }}>
                <tr>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted, width: 80 }}>Row</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted, width: 140 }}>Status</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: C.textMuted }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.rowResults
                  .filter(r => r.status !== "inserted")
                  .slice(0, 200)
                  .map(r => {
                    const meta = {
                      "updated": { label: "Updated", color: C.blue },
                      "skipped_duplicate": { label: "Duplicate", color: "#D97706" },
                      "skipped_no_data": { label: "No data", color: "#6B7280" },
                      "error": { label: "Error", color: C.red },
                      "inserted": { label: "Inserted", color: C.green },
                    }[r.status];
                    return (
                      <tr key={r.rowIndex} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td className="px-3 py-2 tabular-nums" style={{ color: C.textBody }}>{r.rowIndex}</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-[11px] px-2 py-0.5 rounded" style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ color: C.textMuted }}>{r.reason ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex items-center justify-end gap-3">
        <button onClick={onAnother} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>
          Import another file
        </button>
        <button
          onClick={onView}
          className="rounded-lg px-5 py-2 text-sm font-semibold"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1A2E" }}
        >
          View leads →
        </button>
      </div>
    </div>
  );
}

function BreakdownTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-xl font-bold tabular-nums" style={{ color: value > 0 ? color : C.textDim }}>{value.toLocaleString()}</p>
    </div>
  );
}

// ── Reusable: ICP chip that appears at the top of steps 2 / 3 / 4 so
//    the operator never loses sight of which ICP they're loading into. ──

function IcpChip({ icp, onChange }: { icp: IcpRow; onChange?: () => void }) {
  return (
    <div className="rounded-xl border px-4 py-2.5 flex items-center gap-3" style={{ borderColor: `color-mix(in srgb, ${gold} 26%, ${C.border})`, backgroundColor: `color-mix(in srgb, ${gold} 4%, ${C.card})` }}>
      <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
        <Target size={12} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: gold }}>Loading into</p>
        <p className="text-[13px] font-bold truncate" style={{ color: C.textPrimary }}>{icp.profile_name}</p>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-[10.5px] font-semibold px-2 py-1 rounded-md transition-colors hover:bg-black/[0.04]"
          style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
        >
          Change
        </button>
      )}
    </div>
  );
}

// Silence unused-var warning for ALL_CANONICAL — kept as a flat list for
// future reverse-lookups (e.g. "find canonical target by source header
// alias"); not used in the current wizard render path.
void ALL_CANONICAL;
