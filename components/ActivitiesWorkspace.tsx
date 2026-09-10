"use client";

// Activities workspace shell (block 4). Owns: the clickable Overdue/Today/
// Upcoming summary cards (which filter the queue), the "+ New activity" CTA, and
// the List | Board toggle (List is the default). List is the operational work
// queue; Board is the existing 3-column view, kept as the alternate.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { bucketActivity } from "@/lib/activities";
import ActivitiesList from "@/components/ActivitiesList";
import ActivitiesBoard, { type BoardActivity } from "@/components/ActivitiesBoard";
import NewActivityModal from "@/components/NewActivityModal";
import { Plus, AlertTriangle, CalendarClock, CalendarDays, List as ListIcon, LayoutGrid } from "lucide-react";

const gold = "var(--brand, #c9a83a)";
const VIEW_KEY = "activities.view";

type Bucket = "overdue" | "today" | "upcoming";

export default function ActivitiesWorkspace({
  initial, seesAll, currentScope, canAssignOthers,
}: { initial: BoardActivity[]; seesAll: boolean; currentScope: "mine" | "all"; canAssignOthers: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const [view, setView] = useState<"list" | "board">("list");
  const [activeBucket, setActiveBucket] = useState<Bucket | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [team, setTeam] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try { const v = window.localStorage.getItem(VIEW_KEY); if (v === "board" || v === "list") setView(v); } catch { /* */ }
    setHydrated(true);
  }, []);
  function changeView(v: "list" | "board") { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* */ } }

  useEffect(() => {
    fetch("/api/team", { cache: "no-store" }).then(r => r.json()).then(j => {
      if (Array.isArray(j?.team)) { const m: Record<string, string> = {}; for (const p of j.team) m[p.userId] = p.displayName || p.email || p.userId; setTeam(m); }
    }).catch(() => {});
  }, []);

  const now = Date.now();
  const counts = useMemo(() => {
    const c = { overdue: 0, today: 0, upcoming: 0 };
    for (const a of initial) {
      const b = bucketActivity(a, now);
      if (b === "overdue" || b === "today" || b === "upcoming") c[b]++;
    }
    return c;
  }, [initial, now]);

  function clickCard(b: Bucket) {
    setActiveBucket(prev => (prev === b ? null : b));
    changeView("list");
  }

  const CARDS: { key: Bucket; icon: React.ElementType; color: string }[] = [
    { key: "overdue", icon: AlertTriangle, color: C.red },
    { key: "today", icon: CalendarClock, color: gold },
    { key: "upcoming", icon: CalendarDays, color: C.blue },
  ];

  const isEmpty = initial.length === 0;

  return (
    <div className="w-full">
      {/* Header: summary cards + actions */}
      <div className="flex items-start gap-3 flex-wrap mb-5">
        <div className="grid grid-cols-3 gap-2.5 flex-1 min-w-[280px] max-w-xl">
          {CARDS.map(card => {
            const Icon = card.icon;
            const active = activeBucket === card.key;
            return (
              <button key={card.key} onClick={() => clickCard(card.key)}
                className="rounded-xl border px-3 py-2.5 text-left transition-[transform,box-shadow] hover:-translate-y-0.5"
                style={{ backgroundColor: C.card, borderColor: active ? card.color : C.border, boxShadow: active ? `0 0 0 1px ${card.color}` : C.shadow }}>
                <div className="flex items-center gap-1.5">
                  <Icon size={13} style={{ color: card.color }} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{t(`activities.group.${card.key}`)}</span>
                </div>
                <div className="text-[22px] font-bold tabular-nums leading-none mt-1" style={{ color: card.key === "overdue" && counts.overdue > 0 ? C.red : C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {counts[card.key]}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* List | Board toggle */}
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, opacity: hydrated ? 1 : 0 }}>
            <button onClick={() => changeView("list")} title={t("activities.view.list")} className="px-2.5 py-2" style={{ background: view === "list" ? gold : C.card, color: view === "list" ? "#1a1205" : C.textMuted }}><ListIcon size={15} /></button>
            <button onClick={() => changeView("board")} title={t("activities.view.board")} className="px-2.5 py-2" style={{ background: view === "board" ? gold : C.card, color: view === "board" ? "#1a1205" : C.textMuted }}><LayoutGrid size={15} /></button>
          </div>
          <button onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-bold"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}>
            <Plus size={15} /> {t("activities.new")}
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("activities.empty.title")}</p>
          <button onClick={() => setModalOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-bold" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}>
            <Plus size={15} /> {t("activities.empty.cta")}
          </button>
        </div>
      ) : view === "list" ? (
        <ActivitiesList initial={initial} team={team} activeBucket={activeBucket} />
      ) : (
        <ActivitiesBoard initial={initial} seesAll={seesAll} currentScope={currentScope} />
      )}

      <NewActivityModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={() => router.refresh()} canAssignOthers={canAssignOthers} />
    </div>
  );
}
