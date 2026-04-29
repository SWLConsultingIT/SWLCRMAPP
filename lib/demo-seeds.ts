// ─── Demo lead seed pools ──────────────────────────────────────────────────
// Realistic-but-fictional people & companies for populating /admin/demos
// tenants. Industry presets pick from the matching pool; "mixed" picks across.
// Each entry is intentionally lightweight — just enough to render the UI
// (table, lead detail, profile cards) convincingly during a sales call.

export type SeedLead = {
  first: string;
  last: string;
  role: string;
  seniority: "owner" | "c_level" | "vp" | "director" | "manager" | "senior" | "individual";
  company: string;
  industry: string;
  country: string;
  employees: number;
  linkedin: string;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const li = (first: string, last: string, company: string) =>
  `https://www.linkedin.com/in/${slug(first)}-${slug(last)}-${slug(company).slice(0, 12)}`;
const email = (first: string, last: string, company: string) =>
  `${slug(first)}.${slug(last)}@${slug(company).replace(/-/g, "")}.com`;

// ── SaaS / Tech ─────────────────────────────────────────────────────────────
const saas: Omit<SeedLead, "industry">[] = [
  { first: "Marcos", last: "Iturralde", role: "CEO", seniority: "c_level", company: "Drift Labs", country: "Argentina", employees: 28, linkedin: "" },
  { first: "Sofía", last: "Vázquez", role: "Head of Revenue Ops", seniority: "director", company: "Telar Analytics", country: "Argentina", employees: 42, linkedin: "" },
  { first: "Tomás", last: "Iriarte", role: "VP Sales", seniority: "vp", company: "Onda Mensajería API", country: "Mexico", employees: 86, linkedin: "" },
  { first: "Lucía", last: "Marini", role: "Founder", seniority: "owner", company: "Notabene HR", country: "Spain", employees: 14, linkedin: "" },
  { first: "Ezequiel", last: "Bardín", role: "Director of Growth", seniority: "director", company: "Pamper Logística", country: "Argentina", employees: 34, linkedin: "" },
  { first: "Carolina", last: "Salinas", role: "CMO", seniority: "c_level", company: "Brújula CRM", country: "Colombia", employees: 51, linkedin: "" },
  { first: "Joaquín", last: "Reverberi", role: "Sales Director", seniority: "director", company: "Rumbo Datos SaaS", country: "Chile", employees: 23, linkedin: "" },
  { first: "Valeria", last: "Costa", role: "Head of Customer Success", seniority: "director", company: "Compás Billing", country: "Brazil", employees: 67, linkedin: "" },
  { first: "Federico", last: "Lacroix", role: "Co-founder", seniority: "owner", company: "Lapislázuli Insights", country: "Uruguay", employees: 9, linkedin: "" },
  { first: "Antonella", last: "Pieroni", role: "Marketing Manager", seniority: "manager", company: "Cardinal Fintech", country: "Argentina", employees: 38, linkedin: "" },
];

// ── Agency / Marketing ──────────────────────────────────────────────────────
const agency: Omit<SeedLead, "industry">[] = [
  { first: "Ramiro", last: "Velázquez", role: "Managing Director", seniority: "owner", company: "Trébol Digital", country: "Argentina", employees: 16, linkedin: "" },
  { first: "Gabriela", last: "Ferreiro", role: "Head of Performance", seniority: "director", company: "Plantel Studios", country: "Argentina", employees: 22, linkedin: "" },
  { first: "Pedro", last: "Cordero", role: "Founder", seniority: "owner", company: "Lince Branding", country: "Mexico", employees: 11, linkedin: "" },
  { first: "Belén", last: "Marotta", role: "Account Director", seniority: "director", company: "Fanal Creative", country: "Spain", employees: 29, linkedin: "" },
  { first: "Diego", last: "Olmos", role: "CEO", seniority: "c_level", company: "Siroco Media", country: "Chile", employees: 18, linkedin: "" },
  { first: "Nicolás", last: "Peñalva", role: "Strategy Lead", seniority: "senior", company: "Andén Partners", country: "Argentina", employees: 13, linkedin: "" },
  { first: "Ileana", last: "Quesada", role: "Head of Paid Media", seniority: "director", company: "Cobalto Agency", country: "Colombia", employees: 24, linkedin: "" },
  { first: "Mariano", last: "Solís", role: "Creative Director", seniority: "director", company: "Plomada Studio", country: "Uruguay", employees: 8, linkedin: "" },
];

// ── Manufacturing / Industrial ─────────────────────────────────────────────
const manufacturing: Omit<SeedLead, "industry">[] = [
  { first: "Ian", last: "Whitcomb", role: "Operations Director", seniority: "director", company: "Trentham Engineering Ltd", country: "United Kingdom", employees: 142, linkedin: "" },
  { first: "Margaret", last: "Halloway", role: "Finance Director", seniority: "director", company: "Brindley Castings Ltd", country: "United Kingdom", employees: 88, linkedin: "" },
  { first: "Owen", last: "Pritchard", role: "Managing Director", seniority: "owner", company: "Ashbourne Tooling", country: "United Kingdom", employees: 56, linkedin: "" },
  { first: "Helena", last: "Marsh", role: "Head of Procurement", seniority: "director", company: "Riverside Precision", country: "United Kingdom", employees: 64, linkedin: "" },
  { first: "Callum", last: "Donnelly", role: "Plant Manager", seniority: "manager", company: "Lockwood Fabrication", country: "United Kingdom", employees: 121, linkedin: "" },
  { first: "Eve", last: "Sterling", role: "CFO", seniority: "c_level", company: "Pendrick Steel Works", country: "United Kingdom", employees: 207, linkedin: "" },
  { first: "Aaron", last: "Birch", role: "Logistics Manager", seniority: "manager", company: "Garrison Heavy Industries", country: "United Kingdom", employees: 175, linkedin: "" },
  { first: "Ruth", last: "Whittaker", role: "General Manager", seniority: "director", company: "Ledford Plastics Ltd", country: "United Kingdom", employees: 73, linkedin: "" },
];

// ── Hospitality / QSR / Restaurant chains ──────────────────────────────────
const hospitality: Omit<SeedLead, "industry">[] = [
  { first: "Andrew", last: "Hertz", role: "VP of Operations", seniority: "vp", company: "Maple Lane Diner Group", country: "United States", employees: 312, linkedin: "" },
  { first: "Rachel", last: "Tomlinson", role: "Director of Procurement", seniority: "director", company: "Crestwood Hospitality", country: "United States", employees: 188, linkedin: "" },
  { first: "Marcus", last: "Beale", role: "Regional Director", seniority: "director", company: "Sundance Burger Co.", country: "United States", employees: 421, linkedin: "" },
  { first: "Laila", last: "Vance", role: "Head of Marketing", seniority: "director", company: "Northern Bites Cafés", country: "United States", employees: 96, linkedin: "" },
  { first: "Jordan", last: "Pemberton", role: "Franchise Director", seniority: "director", company: "Foundry Pizza Holdings", country: "United States", employees: 245, linkedin: "" },
  { first: "Renata", last: "Solano", role: "COO", seniority: "c_level", company: "Aurora Hotel Collection", country: "United States", employees: 510, linkedin: "" },
  { first: "Devon", last: "Marsh", role: "VP of People", seniority: "vp", company: "Crestwood Hospitality", country: "United States", employees: 188, linkedin: "" },
];

// ── Consulting / IT services ───────────────────────────────────────────────
const consulting: Omit<SeedLead, "industry">[] = [
  { first: "Alejandro", last: "Suárez", role: "Partner", seniority: "owner", company: "Argonauta Consulting", country: "Spain", employees: 34, linkedin: "" },
  { first: "Daiana", last: "Iturra", role: "VP Delivery", seniority: "vp", company: "Pampa IT Studios", country: "Argentina", employees: 78, linkedin: "" },
  { first: "Pablo", last: "Reinosa", role: "Head of Sales", seniority: "director", company: "Hércules Outsourcing", country: "Argentina", employees: 52, linkedin: "" },
  { first: "Cecilia", last: "Maino", role: "Managing Director", seniority: "owner", company: "Norte Tech Advisory", country: "Chile", employees: 19, linkedin: "" },
  { first: "Gonzalo", last: "Berrutti", role: "CTO", seniority: "c_level", company: "Cordillera Software", country: "Uruguay", employees: 41, linkedin: "" },
  { first: "Magdalena", last: "Otero", role: "Practice Lead", seniority: "director", company: "Tramontana IT", country: "Argentina", employees: 28, linkedin: "" },
];

const POOLS: Record<string, Omit<SeedLead, "industry">[]> = {
  saas, agency, manufacturing, hospitality, consulting,
};

const POOL_INDUSTRY: Record<string, string> = {
  saas: "SaaS",
  agency: "Marketing & Advertising",
  manufacturing: "Industrial Manufacturing",
  hospitality: "Hospitality",
  consulting: "IT Consulting",
};

export type DemoIndustryKey = keyof typeof POOLS | "mixed";

export function pickSeedLeads(industry: DemoIndustryKey, count: number): SeedLead[] {
  const pool: Omit<SeedLead, "industry">[] =
    industry === "mixed"
      ? Object.values(POOLS).flat()
      : POOLS[industry] ?? Object.values(POOLS).flat();

  const industryLabel = industry === "mixed" ? "Mixed" : POOL_INDUSTRY[industry] ?? "General";

  // Shuffle deterministically-ish then take `count`. We want the demo to feel
  // fresh on each seed but not break referential bonds between leads.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);

  return shuffled.map(l => ({
    ...l,
    industry: industryLabel,
    linkedin: l.linkedin || li(l.first, l.last, l.company),
  }));
}

export function emailFor(first: string, last: string, company: string): string {
  return email(first, last, company);
}

export const DEMO_INDUSTRY_OPTIONS: { key: DemoIndustryKey; label: string; description: string }[] = [
  { key: "mixed", label: "Mixed", description: "Cross-industry sample — good general demo" },
  { key: "saas", label: "SaaS / Tech", description: "Founders, RevOps, VP Sales at LATAM SaaS" },
  { key: "agency", label: "Agency", description: "Marketing & creative agencies" },
  { key: "manufacturing", label: "Manufacturing (UK)", description: "Industrial / engineering, Pathway-style" },
  { key: "hospitality", label: "Hospitality / QSR", description: "Restaurant chains, hotels — McDonald's-style" },
  { key: "consulting", label: "IT Consulting", description: "Outsourcing, advisory, software factories" },
];
