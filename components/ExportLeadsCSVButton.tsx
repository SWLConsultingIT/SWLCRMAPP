"use client";

import { Download } from "lucide-react";
import { useToast } from "@/lib/toast";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

// Compact CSV export button rendered next to "Import Leads" in the page hero.
// Accepts the already-loaded lead list as a prop (page.tsx caps to 500); if
// the tenant has more, we tell the user via the toast so they know to refine
// with filters or wait for a server-side full export endpoint.

type ExportLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  profile_name?: string | null;
  has_campaign?: boolean;
  reply_count?: number | null;
  has_positive?: boolean;
  created_at?: string | null;
};

type Props = {
  leads: ExportLead[];
  totalLeadCount?: number;
};

export default function ExportLeadsCSVButton({ leads, totalLeadCount }: Props) {
  const toast = useToast();
  const { t } = useLocale();

  function handleExport() {
    if (leads.length === 0) {
      toast.show({ kind: "warning", title: "Nothing to export", description: "There are no leads loaded in this view." });
      return;
    }
    const headers = [
      t("export.header.firstName"), t("export.header.lastName"), t("export.header.company"), t("export.header.role"), t("export.header.email"), t("export.header.phone"),
      "Status", "Score", "Priority", "Profile", "Has Campaign", "Replies", "Positive Reply", "Created",
    ];
    const rows = leads.map(l => [
      l.first_name ?? "",
      l.last_name ?? "",
      l.company ?? "",
      l.role ?? "",
      l.email ?? "",
      l.phone ?? "",
      l.status ?? "",
      l.score ?? "",
      l.is_priority ? "yes" : "no",
      l.profile_name ?? "",
      l.has_campaign ? "yes" : "no",
      l.reply_count ?? 0,
      l.has_positive ? "yes" : "no",
      l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : "",
    ]);
    const escape = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const truncated = typeof totalLeadCount === "number" && totalLeadCount > leads.length;
    toast.show({
      kind: truncated ? "warning" : "success",
      title: `Exported ${leads.length.toLocaleString()} lead${leads.length === 1 ? "" : "s"}`,
      description: truncated
        ? `Tenant has ${totalLeadCount!.toLocaleString()} leads — only the first ${leads.length} were exported. Use filters to narrow the view, then export again.`
        : "CSV downloaded.",
    });
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shrink-0 border transition-opacity hover:opacity-90"
      style={{
        backgroundColor: `color-mix(in srgb, var(--brand, #c9a83a) 10%, var(--c-card))`,
        borderColor: `color-mix(in srgb, var(--brand, #c9a83a) 35%, var(--c-border))`,
        color: C.gold,
      }}
      title="Export the loaded lead list to CSV"
    >
      <Download size={11} />
      Export CSV
    </button>
  );
}
