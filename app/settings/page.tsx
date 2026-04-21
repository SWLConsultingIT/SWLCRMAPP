import { C } from "@/lib/design";
import { Phone, Settings } from "lucide-react";
import PageHero from "@/components/PageHero";
import CallClassificationToggle from "@/components/CallClassificationToggle";

async function getSettings() {
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${url}/rest/v1/app_settings?select=key,value`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const rows = (await res.json().catch(() => [])) as Array<{ key: string; value: unknown }>;
  const s: Record<string, unknown> = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export default async function SettingsPage() {
  const settings = await getSettings();
  const callMode = (settings.call_classification_mode as "manual" | "auto") ?? "manual";

  return (
    <div className="p-6 w-full fade-in">
      <PageHero
        icon={Settings}
        section="Operations"
        title="Settings"
        description="Configure how the CRM handles calls, replies, and automation."
        accentColor="#64748B"
      />

      {/* Section: Calls */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Phone size={14} style={{ color: "#F97316" }} />
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
            Calls
          </h2>
        </div>

        <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="mb-4">
            <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>
              Call outcome classification
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
              After each call ends, choose how the outcome (Positive / Negative / Follow-up) is decided.
              Manual mode requires a salesperson to click the outcome button. Automatic mode uses AI to
              analyze the call transcript (requires Aircall&apos;s transcription add-on).
            </p>
          </div>

          <CallClassificationToggle initialValue={callMode} />
        </div>
      </div>

      {/* Placeholder for future sections */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
            More settings coming soon
          </h2>
        </div>
        <div className="rounded-xl border p-6 text-center" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <p className="text-xs" style={{ color: C.textDim }}>
            Reply automation, working hours, signatures — all coming here.
          </p>
        </div>
      </div>
    </div>
  );
}
