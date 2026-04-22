"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User, SlidersHorizontal, Link2, Phone, Shield, LogOut,
  Mail, Sparkles, CheckCircle2, AlertCircle, Monitor, Moon, Sun,
} from "lucide-react";
import { C } from "@/lib/design";
import CallClassificationToggle from "@/components/CallClassificationToggle";

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

type SectionId = "profile" | "preferences" | "operations" | "integrations";

const SECTIONS: { id: SectionId; label: string; icon: typeof User; description: string }[] = [
  { id: "profile",      label: "Profile",      icon: User,              description: "Your personal info and account" },
  { id: "preferences",  label: "Preferences",  icon: SlidersHorizontal, description: "Language, theme, display" },
  { id: "operations",   label: "Operations",   icon: Phone,             description: "Call classification and automation" },
  { id: "integrations", label: "Integrations", icon: Link2,             description: "LinkedIn, email, calls status" },
];

export default function SettingsLayout({ callMode }: { callMode: "manual" | "auto" }) {
  const router = useRouter();
  const [active, setActive] = useState<SectionId>("profile");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setUser(d.user ?? null)).catch(() => {});
  }, []);

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
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
              style={{
                backgroundColor: isActive ? `${C.gold}12` : "transparent",
                color: isActive ? C.gold : C.textBody,
                borderLeft: isActive ? `3px solid ${C.gold}` : "3px solid transparent",
                paddingLeft: isActive ? "9px" : "12px",
              }}
            >
              <Icon size={14} style={{ color: isActive ? C.gold : C.textMuted }} />
              <span className="text-sm font-medium">{s.label}</span>
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
function ProfileSection({ user }: { user: AuthUser | null }) {
  const roleLabel = user?.role === "admin" ? "Administrator" : user?.role === "client" ? "Client" : "User";
  const roleColor = user?.role === "admin" ? "#7C3AED" : "#0A66C2";

  return (
    <div className="space-y-5">
      <SectionHeader icon={User} title="Profile" description="Your personal info and how others see you" />

      {/* Identity card */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
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
      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Password</h3>
        </div>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>
          We&apos;ll send a secure link to your email to change your password.
        </p>
        <a href="/forgot-password"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border transition-all hover:opacity-80"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
          <Shield size={12} /> Change password
        </a>
      </div>
    </div>
  );
}

// ─── Section: Preferences ───────────────────────────────────────────────────
function PreferencesSection() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");

  return (
    <div className="space-y-5">
      <SectionHeader icon={SlidersHorizontal} title="Preferences" description="Language, theme and display options" />

      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>Theme</h3>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>
          Choose how the app looks. Dark mode is <span className="font-semibold" style={{ color: "#D97706" }}>coming soon</span>.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: "light" as const,  label: "Light",  icon: Sun,     disabled: false },
            { id: "dark" as const,   label: "Dark",   icon: Moon,    disabled: true },
            { id: "system" as const, label: "System", icon: Monitor, disabled: true },
          ].map(opt => {
            const isActive = theme === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => !opt.disabled && setTheme(opt.id)}
                disabled={opt.disabled}
                className="rounded-lg p-4 border-2 transition-all hover:scale-[1.01] disabled:opacity-40 disabled:hover:scale-100"
                style={{
                  backgroundColor: isActive ? `${C.gold}0D` : C.bg,
                  borderColor: isActive ? C.gold : C.border,
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                }}
              >
                <Icon size={20} className="mx-auto mb-2" style={{ color: isActive ? C.gold : C.textDim }} />
                <p className="text-xs font-semibold" style={{ color: isActive ? C.gold : C.textBody }}>
                  {opt.label}
                  {opt.disabled && <span className="block text-[9px] font-normal mt-0.5" style={{ color: C.textDim }}>Coming soon</span>}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>Language</h3>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>Multi-language support is coming soon.</p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
          <span className="text-xs font-semibold" style={{ color: C.textBody }}>English</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>Active</span>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Operations ────────────────────────────────────────────────────
function OperationsSection({ callMode }: { callMode: "manual" | "auto" }) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={Phone} title="Operations" description="How the CRM handles calls and automation" />

      <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="mb-4">
          <h3 className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>Call outcome classification</h3>
          <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
            After each call ends, choose how the outcome (Positive / Negative / Follow-up) is decided.
            Manual requires a salesperson to click. Automatic uses AI on the transcript (requires Aircall&apos;s transcription add-on).
          </p>
        </div>
        <CallClassificationToggle initialValue={callMode} />
      </div>

      <div className="rounded-xl border p-6 border-dashed" style={{ backgroundColor: C.bg, borderColor: C.border }}>
        <p className="text-xs font-semibold" style={{ color: C.textDim }}>Coming soon:</p>
        <ul className="mt-2 space-y-1 text-xs" style={{ color: C.textMuted }}>
          <li>• Reply automation rules (auto-pause campaigns on objections)</li>
          <li>• Working hours (when the AI agent is active)</li>
          <li>• Default signature for emails</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Section: Integrations ──────────────────────────────────────────────────
function IntegrationsSection() {
  const integrations = [
    { name: "LinkedIn (Unipile)", icon: "🔗", status: "connected", color: "#0A66C2", description: "Per-seller LinkedIn accounts via Unipile" },
    { name: "Email (Instantly)",  icon: "✉️", status: "connected", color: "#7C3AED", description: "Shared email pool for outbound campaigns" },
    { name: "Calls (Aircall)",    icon: "📞", status: "connected", color: "#F97316", description: "Outbound calls + recording + AI transcripts" },
    { name: "CRM (Odoo)",         icon: "🏢", status: "connected", color: "#16A34A", description: "Lead sync to Odoo CRM on positive reply" },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader icon={Link2} title="Integrations" description="External services connected to your CRM" />

      <div className="space-y-3">
        {integrations.map(i => (
          <div key={i.name} className="rounded-xl border p-5 flex items-center gap-4"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: `${i.color}15` }}>
              {i.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{i.name}</p>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>
                  <CheckCircle2 size={9} /> Connected
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{i.description}</p>
            </div>
            <button className="text-[10px] font-semibold px-3 py-1.5 rounded-lg border"
              style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}>
              Manage
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
    <div className="flex items-start gap-3 pb-4 border-b" style={{ borderColor: C.border }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${C.gold}15` }}>
        <Icon size={16} style={{ color: C.gold }} />
      </div>
      <div>
        <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>{title}</h2>
        <p className="text-xs" style={{ color: C.textMuted }}>{description}</p>
      </div>
    </div>
  );
}

function LogoutButton({ router }: { router: ReturnType<typeof useRouter> }) {
  const [loading, setLoading] = useState(false);
  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={handleLogout} disabled={loading}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:opacity-80"
      style={{ color: C.red, backgroundColor: "transparent" }}>
      <LogOut size={14} />
      <span className="text-sm font-medium">{loading ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
