"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User, SlidersHorizontal, Link2, Phone, Shield, LogOut,
  CheckCircle2, Moon, Sun,
} from "lucide-react";
import { C } from "@/lib/design";
import { useTheme } from "@/lib/theme";
import { useLocale } from "@/lib/i18n";
import { useAuthUser } from "@/lib/auth-context";
import CallClassificationToggle from "@/components/CallClassificationToggle";
import ChangePasswordModal from "@/components/ChangePasswordModal";

type SectionId = "profile" | "preferences" | "operations" | "integrations";

type SectionDef = { id: SectionId; labelKey: string; icon: typeof User };
const SECTIONS: SectionDef[] = [
  { id: "profile",      labelKey: "settings.profile",      icon: User },
  { id: "preferences",  labelKey: "settings.preferences",  icon: SlidersHorizontal },
  { id: "operations",   labelKey: "settings.operations",   icon: Phone },
  { id: "integrations", labelKey: "settings.integrations", icon: Link2 },
];

export default function SettingsLayout({ callMode }: { callMode: "manual" | "auto" }) {
  const router = useRouter();
  const { t } = useLocale();
  const [active, setActive] = useState<SectionId>("profile");
  // Was a duplicate /api/auth/me fetch on mount — now reads from shared context.
  const user = useAuthUser();

  return (
    <div className="grid grid-cols-[220px_1fr] gap-6">
      {/* ═══ Sidebar interno ═══ */}
      <aside className="space-y-1">
        {SECTIONS.map(s => {
          const isActive = active === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{
                backgroundColor: isActive ? `color-mix(in srgb, ${C.gold} 7%, transparent)` : "transparent",
                color: isActive ? C.gold : C.textBody,
                borderLeft: isActive ? `3px solid ${C.gold}` : "3px solid transparent",
                paddingLeft: isActive ? "9px" : "12px",
              }}
            >
              <Icon size={14} style={{ color: isActive ? C.gold : C.textMuted }} />
              <span className="text-sm font-medium">{t(s.labelKey)}</span>
            </button>
          );
        })}
        <div className="pt-4 mt-4 border-t" style={{ borderColor: C.border }}>
          <LogoutButton router={router} />
        </div>
      </aside>

      {/* ═══ Content ═══ */}
      <div>
        {active === "profile" && <ProfileSection user={user} />}
        {active === "preferences" && <PreferencesSection />}
        {active === "operations" && <OperationsSection callMode={callMode} />}
        {active === "integrations" && <IntegrationsSection />}
      </div>
    </div>
  );
}

// ─── Section: Profile ───────────────────────────────────────────────────────
type ProfileUser = { id: string; email?: string; displayName?: string; role: string } | null;

function ProfileSection({ user }: { user: ProfileUser }) {
  const { t } = useLocale();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const roleLabel = user?.role === "admin" ? t("profile.role.admin") : user?.role === "client" ? t("profile.role.client") : t("profile.role.user");
  const roleColor = user?.role === "admin" ? "#7C3AED" : "#0A66C2";

  return (
    <div className="space-y-5">
      <SectionHeader icon={User} title={t("profile.title")} description={t("profile.subtitle")} />

      {/* Identity card */}
      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${roleColor}, ${roleColor}CC)`, color: "#fff" }}>
            {user?.displayName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: C.textPrimary }}>{user?.displayName ?? "—"}</p>
            <p className="text-sm" style={{ color: C.textMuted }}>{user?.email ?? "—"}</p>
            <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
              style={{ backgroundColor: `${roleColor}15`, color: roleColor }}>
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("profile.password")}</h3>
        </div>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>
          {t("profile.passwordHelp")}
        </p>
        <button onClick={() => setPasswordOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-80"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
          <Shield size={12} /> {t("profile.changePassword")}
        </button>
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} userEmail={user?.email ?? ""} />
    </div>
  );
}

// ─── Section: Preferences ───────────────────────────────────────────────────
function PreferencesSection() {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();

  return (
    <div className="space-y-5">
      <SectionHeader icon={SlidersHorizontal} title={t("prefs.title")} description={t("prefs.subtitle")} />

      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>{t("prefs.theme")}</h3>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>{t("prefs.themeHelp")}</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "light" as const, label: t("prefs.theme.light"), icon: Sun },
            { id: "dark"  as const, label: t("prefs.theme.dark"),  icon: Moon },
          ].map(opt => {
            const isActive = theme === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className="rounded-lg p-4 border-2 transition-[opacity,transform,box-shadow,background-color,border-color] hover:scale-[1.01]"
                style={{
                  backgroundColor: isActive ? `color-mix(in srgb, ${C.gold} 5%, transparent)` : C.bg,
                  borderColor: isActive ? C.gold : C.border,
                  cursor: "pointer",
                }}
              >
                <Icon size={20} className="mx-auto mb-2" style={{ color: isActive ? C.gold : C.textDim }} />
                <p className="text-xs font-semibold" style={{ color: isActive ? C.gold : C.textBody }}>
                  {opt.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <LanguageCard />
      <BrandingCard />
    </div>
  );
}

function BrandingCard() {
  const [primaryColor, setPrimaryColor] = useState<string>("#b79832");
  const [useBrandColors, setUseBrandColors] = useState<boolean>(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/settings/branding").then(r => r.json()).then(d => {
      if (d.primary_color) setPrimaryColor(d.primary_color);
      setUseBrandColors(!!d.use_brand_colors);
      setLogoUrl(d.logo_url ?? null);
    }).catch(() => {});
  }, []);

  async function save(patch: { primary_color?: string; use_brand_colors?: boolean }) {
    setSaving(true);
    const body = {
      primary_color: patch.primary_color ?? primaryColor,
      use_brand_colors: patch.use_brand_colors ?? useBrandColors,
    };
    const r = await fetch("/api/settings/branding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.ok) setSavedAt(Date.now());
  }

  return (
    <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Branding</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: C.textMuted }}>
        Make the app feel like your brand. Primary color is applied to buttons, accents and highlights across the workspace.
      </p>

      <div className="flex items-start gap-5">
        {/* Logo preview */}
        <div className="w-20 h-20 rounded-xl border flex items-center justify-center shrink-0"
          style={{ borderColor: C.border, backgroundColor: "#ffffff" }}>
          {logoUrl
            ? <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5 rounded-xl" />
            : <span className="text-xs" style={{ color: C.textDim }}>No logo</span>}
        </div>

        {/* Color picker + toggle */}
        <div className="flex-1 space-y-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>
              Primary color
            </label>
            <div className="flex items-center gap-3">
              <input type="color" value={primaryColor}
                onChange={e => { setPrimaryColor(e.target.value); save({ primary_color: e.target.value }); }}
                className="w-12 h-10 rounded-lg border cursor-pointer"
                style={{ borderColor: C.border }} />
              <input type="text" value={primaryColor}
                onChange={e => setPrimaryColor(e.target.value)}
                onBlur={() => /^#[0-9A-Fa-f]{6}$/.test(primaryColor) && save({ primary_color: primaryColor })}
                className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono outline-none"
                style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }} />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={useBrandColors}
              onChange={e => { setUseBrandColors(e.target.checked); save({ use_brand_colors: e.target.checked }); }}
              style={{ accentColor: primaryColor }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: C.textBody }}>Apply brand color to the app</p>
              <p className="text-[10px]" style={{ color: C.textDim }}>
                Off by default. Enable once your logo and color are set — the accent color will roll out across buttons and highlights.
              </p>
            </div>
          </label>
        </div>
      </div>

      {saving && <p className="text-[10px] mt-3" style={{ color: C.textDim }}>Saving…</p>}
      {savedAt && !saving && <p className="text-[10px] mt-3" style={{ color: C.green }}>Saved ✓</p>}
    </div>
  );
}

function LanguageCard() {
  const { locale, setLocale, t } = useLocale();
  const options: { id: "en" | "es"; label: string; flag: string }[] = [
    { id: "en", label: "English", flag: "🇺🇸" },
    { id: "es", label: "Español", flag: "🇦🇷" },
  ];
  return (
    <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>{t("prefs.language")}</h3>
      <p className="text-xs mb-4" style={{ color: C.textMuted }}>{t("prefs.languageHelp")}</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map(opt => {
          const isActive = locale === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setLocale(opt.id)}
              className="rounded-lg p-4 border-2 transition-[opacity,transform,box-shadow,background-color,border-color] hover:scale-[1.01] flex items-center gap-3"
              style={{
                backgroundColor: isActive ? `color-mix(in srgb, ${C.gold} 5%, transparent)` : C.bg,
                borderColor: isActive ? C.gold : C.border,
                cursor: "pointer",
              }}
            >
              <span className="text-xl">{opt.flag}</span>
              <span className="text-xs font-semibold" style={{ color: isActive ? C.gold : C.textBody }}>
                {opt.label}
              </span>
              {isActive && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>
                  {t("prefs.active")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: Operations ────────────────────────────────────────────────────
function OperationsSection({ callMode }: { callMode: "manual" | "auto" }) {
  const { t } = useLocale();
  return (
    <div className="space-y-5">
      <SectionHeader icon={Phone} title={t("ops.title")} description={t("ops.subtitle")} />

      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="mb-4">
          <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>{t("ops.callClass")}</h3>
          <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
            {t("ops.callClassHelp")}
          </p>
        </div>
        <CallClassificationToggle initialValue={callMode} />
      </div>

    </div>
  );
}

// ─── Section: Integrations ──────────────────────────────────────────────────
function IntegrationsSection() {
  const { t } = useLocale();
  const integrations = [
    { name: "LinkedIn (Unipile)", icon: "🔗", status: "connected", color: "#0A66C2", description: "Per-seller LinkedIn accounts via Unipile" },
    { name: "Email (Instantly)",  icon: "✉️", status: "connected", color: "#7C3AED", description: "Shared email pool for outbound campaigns" },
    { name: "Calls (Aircall)",    icon: "📞", status: "connected", color: "#F97316", description: "Outbound calls + recording + AI transcripts" },
    { name: "CRM (Odoo)",         icon: "🏢", status: "connected", color: "#16A34A", description: "Lead sync to Odoo CRM on positive reply" },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader icon={Link2} title={t("int.title")} description={t("int.subtitle")} />

      <div className="space-y-3">
        {integrations.map(i => (
          <div
            key={i.name}
            className="rounded-2xl border p-5 flex items-center gap-4 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md"
            style={{
              background: `linear-gradient(135deg, var(--c-card) 0%, color-mix(in srgb, ${i.color} 4%, var(--c-card)) 100%)`,
              borderColor: C.border,
              boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
            }}
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
              style={{
                background: `linear-gradient(135deg, color-mix(in srgb, ${i.color} 14%, transparent), color-mix(in srgb, ${i.color} 4%, transparent))`,
                border: `1px solid color-mix(in srgb, ${i.color} 22%, transparent)`,
                boxShadow: `0 0 14px color-mix(in srgb, ${i.color} 16%, transparent)`,
              }}
            >
              {i.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{i.name}</p>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "#DCFCE7",
                    color: "#16A34A",
                    border: "1px solid color-mix(in srgb, #16A34A 18%, transparent)",
                  }}
                >
                  <CheckCircle2 size={9} /> {t("int.connected")}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{i.description}</p>
            </div>
            <button
              className="text-xs font-semibold px-3.5 py-2 rounded-xl border transition-colors duration-150"
              style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}
            >
              {t("int.manage")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, description }: { icon: typeof User; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3.5 pb-5 border-b" style={{ borderColor: C.border }}>
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${C.gold} 14%, transparent), color-mix(in srgb, ${C.gold} 4%, transparent))`,
          border: `1px solid color-mix(in srgb, ${C.gold} 22%, transparent)`,
          boxShadow: `0 0 18px color-mix(in srgb, ${C.gold} 16%, transparent)`,
        }}
      >
        <Icon size={18} style={{ color: C.gold }} />
      </div>
      <div>
        <h2
          className="text-lg font-bold"
          style={{
            color: C.textPrimary,
            fontFamily: "var(--font-outfit), system-ui, sans-serif",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{description}</p>
      </div>
    </div>
  );
}

function LogoutButton({ router }: { router: ReturnType<typeof useRouter> }) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      localStorage.removeItem("swl-theme");
      localStorage.removeItem("swl-locale");
    } catch {}
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={handleLogout} disabled={loading}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-80"
      style={{ color: C.red, backgroundColor: "transparent" }}>
      <LogOut size={14} />
      <span className="text-sm font-medium">{loading ? t("settings.signingOut") : t("settings.signOut")}</span>
    </button>
  );
}
