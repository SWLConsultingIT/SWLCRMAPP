"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Play, MoreHorizontal, Copy, FolderTree, Trash2, X, ArrowRight, Loader2,
} from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type IcpOption = { id: string; profile_name: string };

export default function TemplateDetailActions({
  templateId, templateName, currentIcpId, icps,
}: {
  templateId: string;
  templateName: string;
  currentIcpId: string | null;
  icps: IcpOption[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"main" | "duplicate" | "move">("main");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) { setSubmenu("main"); return; }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  function handleUse() {
    try { sessionStorage.setItem("swl-pending-template-id", templateId); } catch { /* private mode */ }
    router.push("/campaigns/new");
  }

  async function handleAssign(icpId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b.error ?? "Couldn't move");
        return;
      }
      setMenuOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(icpId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { alert(b.error ?? "Couldn't duplicate"); return; }
      if (b.template?.id) {
        router.push(`/campaigns/templates/${b.template.id}`);
      } else {
        setMenuOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    if (!confirm(`Delete template "${templateName}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b.error ?? "Couldn't delete");
        return;
      }
      router.push("/campaigns");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={handleUse} disabled={busy}
        className="text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
        <Play size={13} /> Use template
      </button>

      <div className="relative" ref={ref}>
        <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
          className="p-2 rounded-lg border disabled:opacity-50"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
          title="More actions">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
        </button>

        {menuOpen && submenu === "main" && (
          <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-lg border shadow-lg overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <button onClick={() => setSubmenu("duplicate")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <Copy size={12} /> Duplicate to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={() => setSubmenu("move")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <FolderTree size={12} /> Move to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04] border-t"
              style={{ color: C.red, borderColor: C.border }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}

        {menuOpen && submenu === "duplicate" && (
          <IcpPicker icps={icps} onPick={handleDuplicate}
            title="Duplicate to which ICP?" onCancel={() => setSubmenu("main")} />
        )}
        {menuOpen && submenu === "move" && (
          <IcpPicker icps={icps} onPick={handleAssign}
            title="Move to which ICP?" excludeId={currentIcpId} onCancel={() => setSubmenu("main")} />
        )}
      </div>
    </div>
  );
}

function IcpPicker({
  icps, onPick, onCancel, title, excludeId,
}: { icps: IcpOption[]; onPick: (id: string) => void; onCancel: () => void; title: string; excludeId?: string | null }) {
  const items = excludeId ? icps.filter(i => i.id !== excludeId) : icps;
  return (
    <div className="absolute right-0 top-full mt-1 z-10 w-64 rounded-lg border shadow-lg overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{title}</span>
        <button onClick={onCancel} className="p-0.5" style={{ color: C.textMuted }}>
          <X size={11} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-center" style={{ color: C.textMuted }}>No ICPs available.</p>
        ) : items.map(icp => (
          <button key={icp.id} onClick={() => onPick(icp.id)}
            className="w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-black/[0.04]"
            style={{ color: C.textBody }}>
            <span className="truncate">{icp.profile_name}</span>
            <ArrowRight size={10} className="shrink-0 ml-2" style={{ color: C.textMuted }} />
          </button>
        ))}
      </div>
    </div>
  );
}
