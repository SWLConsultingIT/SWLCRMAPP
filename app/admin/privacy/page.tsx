import { redirect } from "next/navigation";
import { Lock, Shield } from "lucide-react";
import PageHero from "@/components/PageHero";
import { C } from "@/lib/design";
import { getUserScope, canViewAdminMenu } from "@/lib/scope";
import { getSupabaseService } from "@/lib/supabase-service";
import PrivacyClient from "./PrivacyClient";

type AccessEntry = {
  id: string;
  lead_id: string | null;
  caller: string;
  reason: string | null;
  encryption_mode: string | null;
  occurred_at: string;
};

async function getData(bioId: string | null) {
  if (!bioId) return { mode: "standard" as const, entries: [] as AccessEntry[], totals: { client: 0, swl: 0 } };
  const svc = getSupabaseService();
  const [bioRes, logRes, totalsRes] = await Promise.all([
    svc.from("company_bios").select("encryption_mode, sovereign_endpoint_url, encryption_key_version").eq("id", bioId).single(),
    svc.from("data_access_log").select("id, lead_id, caller, reason, encryption_mode, occurred_at").eq("company_bio_id", bioId).order("occurred_at", { ascending: false }).limit(100),
    svc.from("leads").select("source", { count: "exact", head: false }).eq("company_bio_id", bioId),
  ]);
  let client = 0;
  let swl = 0;
  for (const row of (totalsRes.data ?? []) as Array<{ source: string }>) {
    if (row.source === "client") client++;
    else swl++;
  }
  return {
    mode: (bioRes.data?.encryption_mode ?? "standard") as "standard" | "sovereign",
    sovereignUrl: bioRes.data?.sovereign_endpoint_url ?? null,
    keyVersion: bioRes.data?.encryption_key_version ?? 1,
    entries: (logRes.data ?? []) as AccessEntry[],
    totals: { client, swl },
  };
}

export default async function PrivacyPage() {
  const scope = await getUserScope();
  if (!scope.userId) redirect("/login");
  if (!canViewAdminMenu(scope.tier)) redirect("/");

  const data = await getData(scope.companyBioId);

  return (
    <div className="p-6 w-full">
      <PageHero
        icon={Shield}
        section="Admin"
        title="Data Privacy"
        description="Encryption mode for client-uploaded leads, plus an audit log of every decrypt."
        accentColor={C.gold}
        status={{ label: data.mode === "sovereign" ? "Sovereign" : "Standard", active: true }}
      />

      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Stat icon={Lock} label="Encrypted leads" value={data.totals.client.toLocaleString()} accent={C.green} />
          <Stat icon={Shield} label="Plain leads (SWL)" value={data.totals.swl.toLocaleString()} accent={C.textMuted} />
          <Stat icon={Lock} label="Access log entries" value={data.entries.length.toLocaleString()} sub="last 100" accent={C.blue} />
        </div>

        <PrivacyClient
          mode={data.mode}
          sovereignUrl={data.sovereignUrl}
          keyVersion={data.keyVersion}
          entries={JSON.parse(JSON.stringify(data.entries))}
          tier={scope.tier}
        />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, accent }: { icon: typeof Shield; label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-2xl border p-4 card-lift" style={{ borderColor: C.border, backgroundColor: C.card, borderTop: `3px solid ${accent}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
        <Icon size={14} style={{ color: accent }} />
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color: C.textBody }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{sub}</p>}
    </div>
  );
}
