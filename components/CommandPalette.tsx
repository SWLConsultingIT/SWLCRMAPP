"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import {
  Search, ArrowRight, CheckCircle, XCircle, Clock, MinusCircle, Loader2,
  LayoutDashboard, Users, Megaphone, Building2, Target, Shield, Bell,
  Trophy, UserCircle, Settings, MessageCircle, BookOpen, Plus,
} from "lucide-react";

type LeadResult = {
  id: string; first_name: string; last_name: string;
  company: string; role: string; status: string; email: string;
};

type NavCommand = {
  id: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  href: string;
  group: "navigation" | "actions";
  keywords?: string[];
};

const statusConfig: Record<string, { color: string; icon: React.ElementType }> = {
  new:         { color: C.cyan,     icon: Clock },
  contacted:   { color: C.gold,     icon: Clock },
  qualified:   { color: C.green,    icon: CheckCircle },
  cold:        { color: C.textBody, icon: MinusCircle },
  closed_lost: { color: C.red,      icon: XCircle },
};

export default function CommandPalette() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [leadResults, setLeadResults] = useState<LeadResult[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Static commands — labels follow the active locale.
  const navCommands: NavCommand[] = useMemo(() => [
    { id: "dashboard",  label: t("nav.dashboard"),    hint: locale === "es" ? "Vista general"      : "Overview",                      icon: LayoutDashboard, href: "/",              group: "navigation", keywords: ["home", "inicio"] },
    { id: "leads",      label: t("nav.leads"),        hint: locale === "es" ? "Leads y campañas"   : "Leads and campaigns",           icon: Users,           href: "/leads",         group: "navigation", keywords: ["pipeline", "prospects"] },
    { id: "campaigns",  label: "Outreach Flow™",      hint: locale === "es" ? "Crear y gestionar campañas" : "Create and manage campaigns", icon: Megaphone,       href: "/campaigns",     group: "navigation", keywords: ["outreach", "campaigns", "campañas"] },
    { id: "icp",        label: "Lead Miner™",         hint: locale === "es" ? "Perfiles ICP"        : "ICP profiles",                  icon: Target,          href: "/icp",           group: "navigation", keywords: ["icp", "miner", "profiles"] },
    { id: "voice",      label: "Voice & Templates",    hint: locale === "es" ? "Marca, plantillas y secuencias" : "Brand voice, templates, sequences", icon: MessageCircle,   href: "/voice",         group: "navigation", keywords: ["templates", "sequences", "brand", "voice", "plantillas"] },
    { id: "accounts",   label: t("nav.accounts"),     hint: locale === "es" ? "Sellers y conexiones LinkedIn" : "Sellers and LinkedIn accounts", icon: UserCircle,      href: "/accounts",      group: "navigation", keywords: ["sellers", "linkedin", "unipile", "aircall"] },
    { id: "ops",        label: t("nav.opportunities"), hint: locale === "es" ? "Leads convertidos"  : "Converted leads",               icon: Trophy,          href: "/opportunities", group: "navigation", keywords: ["wins", "won", "ganados"] },
    { id: "queue",      label: t("nav.queue"),        hint: locale === "es" ? "Tareas pendientes"  : "Pending tasks",                 icon: Bell,            href: "/queue",         group: "navigation", keywords: ["calls", "reviews", "replies"] },
    { id: "company",    label: t("nav.companyBio"),   hint: locale === "es" ? "Empresas"            : "Companies",                     icon: Building2,       href: "/company-bios",  group: "navigation", keywords: ["company", "empresa", "bios"] },
    { id: "admin",      label: t("nav.admin"),        hint: locale === "es" ? "Panel admin (interno)" : "Admin panel (internal)",      icon: Shield,          href: "/admin",         group: "navigation", keywords: ["admin", "internal"] },
    { id: "settings",   label: t("nav.settings"),     hint: locale === "es" ? "Tu cuenta"           : "Your account",                  icon: Settings,        href: "/settings",      group: "navigation", keywords: ["account", "preferences", "language"] },
    // Quick actions
    { id: "new-template",  label: locale === "es" ? "Nueva plantilla"  : "New template",  hint: "Voice & Templates → Library", icon: Plus,      href: "/voice?tab=templates", group: "actions", keywords: ["template", "plantilla"] },
    { id: "new-sequence",  label: locale === "es" ? "Nueva secuencia"  : "New sequence",  hint: "Voice & Templates → Sequences", icon: BookOpen, href: "/voice?tab=sequences", group: "actions", keywords: ["sequence", "secuencia"] },
    { id: "new-campaign",  label: locale === "es" ? "Nueva campaña"    : "New campaign",  hint: "Outreach Flow™",            icon: Megaphone, href: "/campaigns/new",       group: "actions", keywords: ["campaign", "campaña", "outreach"] },
  ], [t, locale]);

  // Filter nav commands by query (case-insensitive substring on label, hint, keywords).
  const filteredNav = useMemo(() => {
    if (!query.trim()) return navCommands;
    const q = query.toLowerCase().trim();
    return navCommands.filter(c =>
      c.label.toLowerCase().includes(q)
      || c.hint.toLowerCase().includes(q)
      || c.keywords?.some(k => k.toLowerCase().includes(q))
    );
  }, [query, navCommands]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setLeadResults([]);
      setCursor(0);
    }
  }, [open]);

  const searchLeads = useCallback((q: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 2) { setLeadResults([]); return; }
    debounce.current = setTimeout(async () => {
      setLoadingLeads(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}`);
        const { leads } = await res.json();
        setLeadResults(leads ?? []);
      } finally { setLoadingLeads(false); }
    }, 200);
  }, []);

  // Combined ordered list for keyboard navigation.
  const flat = useMemo(() => {
    const items: Array<
      | { kind: "nav"; data: NavCommand }
      | { kind: "lead"; data: LeadResult }
    > = [];
    for (const c of filteredNav) items.push({ kind: "nav", data: c });
    for (const l of leadResults) items.push({ kind: "lead", data: l });
    return items;
  }, [filteredNav, leadResults]);

  function activate(idx: number) {
    const item = flat[idx];
    if (!item) return;
    setOpen(false);
    if (item.kind === "nav") router.push(item.data.href);
    else router.push(`/leads/${item.data.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter")     { e.preventDefault(); activate(cursor); }
  }

  // When query changes, kick off lead search and reset cursor.
  useEffect(() => {
    setCursor(0);
    searchLeads(query);
  }, [query, searchLeads]);

  if (!open) return null;

  const navItems = filteredNav;
  const navStartIdx = 0;
  const leadStartIdx = navItems.length;

  const placeholder = locale === "es"
    ? "Buscar leads, navegar, ejecutar acciones…"
    : "Search leads, navigate, run actions…";
  const noResultsLabel = locale === "es" ? `Sin resultados para "${query}"` : `No results for "${query}"`;
  const navHeading     = locale === "es" ? "Navegación" : "Navigation";
  const actionsHeading = locale === "es" ? "Acciones rápidas" : "Quick actions";
  const leadsHeading   = locale === "es" ? "Leads" : "Leads";

  // Split nav into navigation vs actions for visual grouping.
  const navOnly = navItems.filter(c => c.group === "navigation");
  const actionsOnly = navItems.filter(c => c.group === "actions");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      style={{ backgroundColor: "rgba(4,7,13,0.7)", backdropFilter: "blur(8px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border overflow-hidden fade-in"
        style={{
          backgroundColor: C.card,
          borderColor: C.border,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45), 0 8px 16px rgba(0,0,0,0.2)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: C.border }}>
          {loadingLeads
            ? <Loader2 size={16} style={{ color: C.gold }} className="animate-spin shrink-0" />
            : <Search size={16} style={{ color: C.textMuted }} className="shrink-0" />}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: C.textPrimary }}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-1.5">
          {navOnly.length > 0 && (
            <Group label={navHeading}>
              {navOnly.map((cmd) => {
                const idx = navStartIdx + navItems.indexOf(cmd);
                return (
                  <NavRow key={cmd.id} cmd={cmd} active={cursor === idx} onClick={() => activate(idx)} onMouseEnter={() => setCursor(idx)} />
                );
              })}
            </Group>
          )}
          {actionsOnly.length > 0 && (
            <Group label={actionsHeading}>
              {actionsOnly.map((cmd) => {
                const idx = navStartIdx + navItems.indexOf(cmd);
                return (
                  <NavRow key={cmd.id} cmd={cmd} active={cursor === idx} onClick={() => activate(idx)} onMouseEnter={() => setCursor(idx)} />
                );
              })}
            </Group>
          )}
          {leadResults.length > 0 && (
            <Group label={leadsHeading}>
              {leadResults.map((r, i) => {
                const idx = leadStartIdx + i;
                const st = statusConfig[r.status] ?? statusConfig.new;
                const Icon = st.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => activate(idx)}
                    onMouseEnter={() => setCursor(idx)}
                    className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-150"
                    style={{ backgroundColor: cursor === idx ? C.surface : "transparent" }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`,
                        color: "#04070d",
                      }}
                    >
                      {r.first_name?.[0]}{r.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: C.textPrimary }}>
                        {r.first_name} {r.last_name}
                      </p>
                      <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                        {r.company}{r.role ? ` · ${r.role}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Icon size={11} style={{ color: st.color }} />
                      <ArrowRight size={12} style={{ color: C.textDim }} />
                    </div>
                  </button>
                );
              })}
            </Group>
          )}
          {flat.length === 0 && query.length >= 2 && !loadingLeads && (
            <p className="px-5 py-8 text-[13px] text-center" style={{ color: C.textDim }}>
              {noResultsLabel}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t flex items-center gap-4" style={{ borderColor: C.border }}>
          {[
            ["↑↓", locale === "es" ? "navegar" : "navigate"],
            ["↵",  locale === "es" ? "abrir"   : "open"],
            ["esc", locale === "es" ? "cerrar" : "close"],
          ].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5 text-[10px]" style={{ color: C.textDim }}>
              <kbd
                className="px-1 py-0.5 rounded font-mono"
                style={{ backgroundColor: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}
              >
                {k}
              </kbd>
              {l}
            </span>
          ))}
          <span className="ml-auto text-[10px]" style={{ color: C.textDim }}>
            <kbd
              className="px-1 py-0.5 rounded font-mono"
              style={{ backgroundColor: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}
            >
              ⌘K
            </kbd>{" "}
            {locale === "es" ? "para abrir" : "to open"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-5 py-1 text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: C.textDim }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function NavRow({ cmd, active, onClick, onMouseEnter }: {
  cmd: NavCommand;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const Icon = cmd.icon;
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-150"
      style={{ backgroundColor: active ? C.surface : "transparent" }}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{
          backgroundColor: active ? "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)" : C.bg,
        }}
      >
        <Icon size={14} style={{ color: active ? C.gold : C.textMuted }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate" style={{ color: C.textPrimary }}>{cmd.label}</p>
        <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{cmd.hint}</p>
      </div>
      <ArrowRight size={12} style={{ color: active ? C.gold : C.textDim }} />
    </button>
  );
}
