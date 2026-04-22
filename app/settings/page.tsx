import { Settings } from "lucide-react";
import PageHero from "@/components/PageHero";
import SettingsLayout from "./SettingsLayout";

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
        description="Configure your account, preferences, integrations and automation rules."
        accentColor="#64748B"
      />

      <SettingsLayout callMode={callMode} />
    </div>
  );
}
