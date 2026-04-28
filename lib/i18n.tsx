"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "en" | "es";

type Dict = Record<string, string>;

const en: Dict = {
  // Sidebar sections
  "nav.section.main": "MAIN",
  "nav.section.growth": "GROWTH ENGINE",
  "nav.section.operations": "OPERATIONS",
  // Sidebar items
  "nav.dashboard": "Dashboard",
  "nav.companyBio": "Company Bio",
  "nav.leads": "Leads & Campaigns",
  "nav.accounts": "Accounts",
  "nav.opportunities": "Opportunities",
  "nav.queue": "Notifications",
  "nav.settings": "Settings",
  "nav.admin": "Admin",
  "nav.aiActive": "AI Models Active",
  "nav.growthPlatform": "Growth Platform",
  // TopHeader
  "header.search": "Ask anything...",
  "header.signOut": "Sign out",
  // Settings sections
  "settings.profile": "Profile",
  "settings.profile.desc": "Your personal info and account",
  "settings.preferences": "Preferences",
  "settings.preferences.desc": "Language, theme, display",
  "settings.operations": "Operations",
  "settings.operations.desc": "Call classification and automation",
  "settings.integrations": "Integrations",
  "settings.integrations.desc": "LinkedIn, email, calls status",
  "settings.signOut": "Sign out",
  "settings.signingOut": "Signing out…",
  // Profile section
  "profile.title": "Profile",
  "profile.subtitle": "Your personal info and how others see you",
  "profile.password": "Password",
  "profile.passwordHelp": "We'll send a secure link to your email to change your password.",
  "profile.changePassword": "Change password",
  "profile.role.admin": "Administrator",
  "profile.role.client": "Client",
  "profile.role.user": "User",
  // Preferences
  "prefs.title": "Preferences",
  "prefs.subtitle": "Language, theme and display options",
  "prefs.theme": "Theme",
  "prefs.themeHelp": "Choose how the app looks.",
  "prefs.theme.light": "Light",
  "prefs.theme.dark": "Dark",
  "prefs.language": "Language",
  "prefs.languageHelp": "Display language for the application interface.",
  "prefs.active": "Active",
  // Operations
  "ops.title": "Operations",
  "ops.subtitle": "How the CRM handles calls and automation",
  "ops.callClass": "Call outcome classification",
  "ops.callClassHelp": "After each call ends, choose how the outcome (Positive / Negative / Follow-up) is decided. Manual requires a salesperson to click. Automatic uses AI on the transcript (requires Aircall's transcription add-on).",
  // Integrations
  "int.title": "Integrations",
  "int.subtitle": "External services connected to your CRM",
  "int.connected": "Connected",
  "int.manage": "Manage",
  // Page hero: Settings
  "page.settings.section": "OPERATIONS",
  "page.settings.title": "Settings",
  "page.settings.desc": "Configure your account, preferences, integrations and automation rules.",
  // Dashboard
  "dash.pillLive": "GROWTHAI SALES ENGINE · LIVE",
  "dash.title.a": "Pipeline overview",
  "dash.title.b": "at a glance.",
  "dash.subtitle": "Active campaigns, replies, key metrics — everything that matters this week, in one frame.",
  "dash.cta.newCampaign": "New campaign",
  "dash.cta.voice": "Voice & Templates",
  "dash.stat.totalLeads": "Total Leads",
  "dash.stat.inActive": "In Active Campaign",
  "dash.stat.repliesWeek": "Replies This Week",
  "dash.stat.positiveWeek": "Positive This Week",
  "dash.stat.transferred": "Transferred to CRM",
  // Company bio page
  "bio.industry": "Industry",
  "bio.team": "Team",
  "bio.founded": "Founded",
  "bio.languages": "Languages",
  "bio.servicesCount": "Services",
  "bio.onlinePresence": "Online Presence",
  "bio.aboutCompany": "About the Company",
  "bio.valueProposition": "Value Proposition",
  "bio.differentiators": "Differentiators",
  "bio.targetMarket": "Target Market",
  "bio.toneOfVoice": "Tone of Voice",
  "bio.trackRecord": "Track Record",
  "bio.keyClients": "Key Clients",
  "bio.certifications": "Certifications & Awards",
  "bio.caseStudies": "Case Studies / Portfolio",
  "bio.readMore": "Read more →",
  "bio.attachment": "Attachment",
  "bio.resources": "Resources",
  "bio.leadsCampaigns": "Leads & Campaigns",
  "bio.viewAll": "View all",
  "bio.noLeads": "No leads linked to this company yet.",
  "bio.noLeadsHint": "Leads will appear here once they are imported and assigned.",
  "bio.stat.total": "Total",
  "bio.stat.active": "Active",
  "bio.stat.responded": "Responded",
  "bio.stat.qualified": "Qualified",
  "bio.noCampaign": "No campaign assigned",
  "bio.leadsSuffix": "leads",
  "bio.leadSuffix": "lead",
  "bio.notSpecified": "Not specified",
  "bio.edit": "Edit",
  "bio.lang.spanish": "Spanish",
  "bio.lang.english": "English",
  // Bio scanner
  "bio.scan.title": "Company Bio Scanner",
  "bio.scan.subtitle": "Scan a client's website in real-time to generate a comprehensive AI company breakdown and contact strategy.",
  "bio.scan.ready": "Ready",
  "bio.scan.indexer": "AI Web Indexer",
  "bio.scan.target": "Target website",
  "bio.scan.lang": "Scan language",
  "bio.scan.cta": "Scan web",
  "bio.scan.scanning": "Scanning…",
  "bio.scan.placeholder": "e.g. https://www.acme-corp.com",
  // Bio empty state
  "bio.empty.title": "No company profile yet",
  "bio.empty.subtitle": "Scan a website above or create your profile manually. This info personalizes your AI outreach.",
  "bio.empty.cta": "Create manually",
  "bio.empty.step1": "Enter your company info",
  "bio.empty.step2": "AI personalizes messages",
  "bio.empty.step3": "Better outreach, more replies",
  // Bio breadcrumb
  "bio.breadcrumb": "Company Bio",
  "bio.editing": "Editing",
  "bio.newCompany": "New company",
  "bio.editHint": "Only the name is required — everything else can be added later.",
};

const es: Dict = {
  // Sidebar sections
  "nav.section.main": "PRINCIPAL",
  "nav.section.growth": "GROWTH ENGINE",
  "nav.section.operations": "OPERACIONES",
  // Sidebar items
  "nav.dashboard": "Tablero",
  "nav.companyBio": "Perfil de Empresa",
  "nav.leads": "Leads y Campañas",
  "nav.accounts": "Cuentas",
  "nav.opportunities": "Oportunidades",
  "nav.queue": "Notificaciones",
  "nav.settings": "Configuración",
  "nav.admin": "Administración",
  "nav.aiActive": "Modelos AI activos",
  "nav.growthPlatform": "Growth Platform",
  // TopHeader
  "header.search": "Preguntá lo que quieras...",
  "header.signOut": "Cerrar sesión",
  // Settings sections
  "settings.profile": "Perfil",
  "settings.profile.desc": "Tu información personal y cuenta",
  "settings.preferences": "Preferencias",
  "settings.preferences.desc": "Idioma, tema, visualización",
  "settings.operations": "Operaciones",
  "settings.operations.desc": "Clasificación de llamadas y automatización",
  "settings.integrations": "Integraciones",
  "settings.integrations.desc": "Estado de LinkedIn, email y llamadas",
  "settings.signOut": "Cerrar sesión",
  "settings.signingOut": "Cerrando sesión…",
  // Profile section
  "profile.title": "Perfil",
  "profile.subtitle": "Tu información personal y cómo te ven los demás",
  "profile.password": "Contraseña",
  "profile.passwordHelp": "Te enviamos un link seguro a tu email para cambiar la contraseña.",
  "profile.changePassword": "Cambiar contraseña",
  "profile.role.admin": "Administrador",
  "profile.role.client": "Cliente",
  "profile.role.user": "Usuario",
  // Preferences
  "prefs.title": "Preferencias",
  "prefs.subtitle": "Opciones de idioma, tema y visualización",
  "prefs.theme": "Tema",
  "prefs.themeHelp": "Elegí cómo se ve la app.",
  "prefs.theme.light": "Claro",
  "prefs.theme.dark": "Oscuro",
  "prefs.language": "Idioma",
  "prefs.languageHelp": "Idioma de la interfaz de la aplicación.",
  "prefs.active": "Activo",
  // Operations
  "ops.title": "Operaciones",
  "ops.subtitle": "Cómo el CRM maneja llamadas y automatización",
  "ops.callClass": "Clasificación de resultado de llamada",
  "ops.callClassHelp": "Después de cada llamada, elegí cómo se decide el resultado (Positivo / Negativo / Seguimiento). Manual requiere que un vendedor haga click. Automático usa AI sobre la transcripción (requiere el add-on de transcripción de Aircall).",
  // Integrations
  "int.title": "Integraciones",
  "int.subtitle": "Servicios externos conectados a tu CRM",
  "int.connected": "Conectado",
  "int.manage": "Administrar",
  // Page hero: Settings
  "page.settings.section": "OPERACIONES",
  "page.settings.title": "Configuración",
  "page.settings.desc": "Configurá tu cuenta, preferencias, integraciones y reglas de automatización.",
  // Dashboard
  "dash.pillLive": "GROWTHAI SALES ENGINE · EN VIVO",
  "dash.title.a": "Vista general del pipeline",
  "dash.title.b": "a un vistazo.",
  "dash.subtitle": "Campañas activas, respuestas, métricas clave — todo lo que importa esta semana, en una sola vista.",
  "dash.cta.newCampaign": "Nueva campaña",
  "dash.cta.voice": "Voz y Plantillas",
  "dash.stat.totalLeads": "Total de Leads",
  "dash.stat.inActive": "En Campaña Activa",
  "dash.stat.repliesWeek": "Respuestas esta semana",
  "dash.stat.positiveWeek": "Positivas esta semana",
  "dash.stat.transferred": "Transferidos al CRM",
  // Company bio page
  "bio.industry": "Industria",
  "bio.team": "Equipo",
  "bio.founded": "Fundada",
  "bio.languages": "Idiomas",
  "bio.servicesCount": "Servicios",
  "bio.onlinePresence": "Presencia online",
  "bio.aboutCompany": "Sobre la empresa",
  "bio.valueProposition": "Propuesta de valor",
  "bio.differentiators": "Diferenciadores",
  "bio.targetMarket": "Mercado objetivo",
  "bio.toneOfVoice": "Tono de voz",
  "bio.trackRecord": "Antecedentes",
  "bio.keyClients": "Clientes clave",
  "bio.certifications": "Certificaciones y premios",
  "bio.caseStudies": "Casos de éxito / Portfolio",
  "bio.readMore": "Leer más →",
  "bio.attachment": "Adjunto",
  "bio.resources": "Recursos",
  "bio.leadsCampaigns": "Leads y campañas",
  "bio.viewAll": "Ver todos",
  "bio.noLeads": "No hay leads vinculados a esta empresa todavía.",
  "bio.noLeadsHint": "Los leads aparecerán acá una vez importados y asignados.",
  "bio.stat.total": "Total",
  "bio.stat.active": "Activos",
  "bio.stat.responded": "Respondieron",
  "bio.stat.qualified": "Calificados",
  "bio.noCampaign": "Sin campaña asignada",
  "bio.leadsSuffix": "leads",
  "bio.leadSuffix": "lead",
  "bio.notSpecified": "No especificado",
  "bio.edit": "Editar",
  "bio.lang.spanish": "Español",
  "bio.lang.english": "Inglés",
  // Bio scanner
  "bio.scan.title": "Escáner de empresa",
  "bio.scan.subtitle": "Escaneá el sitio web de un cliente en tiempo real para generar un análisis completo de la empresa y estrategia de contacto con AI.",
  "bio.scan.ready": "Listo",
  "bio.scan.indexer": "AI Web Indexer",
  "bio.scan.target": "Sitio objetivo",
  "bio.scan.lang": "Idioma del escaneo",
  "bio.scan.cta": "Escanear web",
  "bio.scan.scanning": "Escaneando…",
  "bio.scan.placeholder": "ej. https://www.acme-corp.com",
  // Bio empty state
  "bio.empty.title": "Todavía no hay perfil de empresa",
  "bio.empty.subtitle": "Escaneá un sitio arriba o creá tu perfil manualmente. Esta info personaliza tu outreach con AI.",
  "bio.empty.cta": "Crear manualmente",
  "bio.empty.step1": "Cargá la info de tu empresa",
  "bio.empty.step2": "AI personaliza los mensajes",
  "bio.empty.step3": "Mejor outreach, más respuestas",
  // Bio breadcrumb
  "bio.breadcrumb": "Perfil de empresa",
  "bio.editing": "Editando",
  "bio.newCompany": "Nueva empresa",
  "bio.editHint": "Solo el nombre es obligatorio — todo lo demás se puede agregar después.",
};

const dicts: Record<Locale, Dict> = { en, es };

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}>({ locale: "en", setLocale: () => {}, t: (k) => k });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    // Anti-FOUC cache
    const saved = localStorage.getItem("swl-locale") as Locale | null;
    if (saved === "es" || saved === "en") setLocaleState(saved);

    // Source of truth: DB (per-user)
    fetch("/api/settings/prefs")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const dbLocale: Locale = d.locale === "es" ? "es" : "en";
        setLocaleState(dbLocale);
        try { localStorage.setItem("swl-locale", dbLocale); } catch {}
      })
      .catch(() => {});
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try { localStorage.setItem("swl-locale", l); } catch {}
    fetch("/api/settings/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {});
  }

  function t(key: string) {
    return dicts[locale][key] ?? dicts.en[key] ?? key;
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);
