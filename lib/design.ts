// SWL Brand tokens — single source of truth
// Structural colors use CSS variables (var(--c-*)) so dark mode switches automatically.
// Brand/semantic colors stay as hex — they're used with string concatenation (e.g. `${C.gold}15`).

export const C = {
  // ── Sidebar ──
  sidebarBg:          "var(--c-sidebarBg)",
  sidebarBorder:      "var(--c-sidebarBorder)",
  gold:               "#c9a83a",
  goldDim:            "#8c7225",
  goldGlow:           "rgba(201,168,58,0.12)",
  goldSoft:           "rgba(201,168,58,0.08)",
  sidebarText:        "var(--c-sidebarText)",
  sidebarTextActive:  "var(--c-sidebarTextActive)",
  sidebarSection:     "var(--c-sidebarSection)",

  // ── Content area ──
  bg:             "var(--c-bg)",
  surface:        "var(--c-surface)",
  card:           "var(--c-card)",
  cardHov:        "var(--c-cardHov)",
  border:         "var(--c-border)",
  border2:        "var(--c-border2)",

  // ── Shadow system ──
  shadow:         "var(--c-shadow)",
  shadowMd:       "var(--c-shadowMd)",
  shadowLg:       "var(--c-shadowLg)",

  // ── AI accent (purple — distinct from gold for AI-powered features) ──
  aiAccent:       "#7C3AED",
  aiAccentLight:  "var(--c-aiAccentLight)",

  // ── Brand accent (teal — bridges sidebar navy to content) ──
  accent:         "#1A7F74",
  accentLight:    "var(--c-accentLight)",
  accentDark:     "#145F56",

  // ── Semantic ──
  green:          "#059669",
  greenLight:     "var(--c-greenLight)",
  red:            "#DC2626",
  redLight:       "var(--c-redLight)",
  orange:         "#EA580C",
  orangeLight:    "var(--c-orangeLight)",
  blue:           "#2563EB",
  blueLight:      "var(--c-blueLight)",
  yellow:         "#D97706",
  yellowLight:    "var(--c-yellowLight)",

  // ── Score badges ──
  hot:            "#DC2626",
  hotBg:          "#FEE2E2",
  warm:           "#EA580C",
  warmBg:         "#FFEDD5",
  nurture:        "#1A7F74",
  nurtureBg:      "#E6F5F3",

  // ── Text ──
  textPrimary:    "var(--c-textPrimary)",
  textBody:       "var(--c-textBody)",
  textMuted:      "var(--c-textMuted)",
  textDim:        "var(--c-textDim)",
  textOnDark:     "var(--c-textOnDark)",

  // ── Channel icons ──
  linkedin:       "#0A66C2",
  email:          "#059669",
  phone:          "#EA580C",

  // ── Legacy aliases (for components not yet migrated) ──
  cyan:           "#0A66C2",
  cyanGlow:       "rgba(10,102,194,0.1)",
  greenGlow:      "#ECFDF5",
  redGlow:        "#FEF2F2",
  yellowGlow:     "#FFFBEB",
} as const;

export type Color = typeof C;
