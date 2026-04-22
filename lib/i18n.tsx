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
  "nav.queue": "Queue",
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
  "nav.queue": "Cola",
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
    const saved = localStorage.getItem("swl-locale") as Locale | null;
    if (saved === "es" || saved === "en") setLocaleState(saved);
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    localStorage.setItem("swl-locale", l);
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
