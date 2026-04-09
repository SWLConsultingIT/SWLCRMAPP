// SWL Brand tokens — single source of truth
// Sidebar: dark navy theme (unchanged)
// Content: clean light theme that complements the sidebar

export const C = {
  // ── Sidebar (dark) ──
  sidebarBg:      "#050810",
  sidebarBorder:  "#1a2540",
  gold:           "#c9a83a",
  goldDim:        "#8c7225",
  goldGlow:       "rgba(201,168,58,0.15)",

  // ── Content area (light) ──
  bg:             "#F7F8FB",
  surface:        "#FFFFFF",
  card:           "#FFFFFF",
  cardHov:        "#F9FAFB",
  border:         "#E2E5EB",
  border2:        "#D1D5DB",

  // ── Brand accent (teal — bridges sidebar navy to content) ──
  accent:         "#1A7F74",
  accentLight:    "#E6F5F3",
  accentDark:     "#145F56",

  // ── Semantic ──
  green:          "#059669",
  greenLight:     "#ECFDF5",
  red:            "#DC2626",
  redLight:       "#FEF2F2",
  orange:         "#EA580C",
  orangeLight:    "#FFF7ED",
  blue:           "#2563EB",
  blueLight:      "#EFF6FF",
  yellow:         "#D97706",
  yellowLight:    "#FFFBEB",

  // ── Score badges ──
  hot:            "#DC2626",
  hotBg:          "#FEE2E2",
  warm:           "#EA580C",
  warmBg:         "#FFEDD5",
  nurture:        "#1A7F74",
  nurtureBg:      "#E6F5F3",

  // ── Text ──
  textPrimary:    "#111827",
  textBody:       "#374151",
  textMuted:      "#6B7280",
  textDim:        "#9CA3AF",
  textOnDark:     "#E6EAF4",

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
