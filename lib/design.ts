// SWL Brand tokens — single source of truth
// Structural colors use CSS variables (var(--c-*)) so dark mode switches automatically.
// C.gold is var(--brand) so BrandProvider can override per-company at runtime.
// NEVER concat hex alpha to C.gold (e.g. `${C.gold}15`) — use `color-mix(in srgb, ${C.gold} N%, transparent)` instead.

export const C = {
  // ── Sidebar ──
  sidebarBg:          "var(--c-sidebarBg)",
  sidebarBorder:      "var(--c-sidebarBorder)",
  gold:               "var(--brand, #c9a83a)",
  goldDim:            "color-mix(in srgb, var(--brand, #c9a83a) 70%, black)",
  goldGlow:           "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)",
  goldSoft:           "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)",
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

// ── Typography scale (Inter body, Outfit headings) ──────────────────────────
// Single source of truth so every page uses the same rhythm. Use these exact
// values in className via arbitrary brackets (e.g. `text-[15px]`) when the
// stock Tailwind sizes don't fit. Naming follows the visual hierarchy, not
// pixel sizes, so the scale can be re-tuned without rewriting components.
export const T = {
  pageTitle:   "text-[28px] leading-[1.1] font-bold tracking-[-0.02em]",
  sectionTitle:"text-[20px] leading-tight font-semibold tracking-[-0.015em]",
  cardTitle:   "text-[15px] font-semibold",
  body:        "text-[13.5px] leading-[1.55]",
  bodyMuted:   "text-[13.5px] leading-[1.55] text-[color:var(--c-textMuted)]",
  label:       "text-[10px] font-bold tracking-[0.16em] uppercase",
  metaSmall:   "text-[11px] leading-tight",
  numLg:       "text-[28px] font-bold tracking-tight tabular",
  numMd:       "text-[20px] font-semibold tabular",
} as const;

// ── Hover / interaction system (single source of truth) ─────────────────────
// Use these className strings instead of ad-hoc `hover:opacity-80` /
// `hover:scale-[1.02]` mixes. All transitions are explicit (never `all`) and
// respect prefers-reduced-motion via the global rule in globals.css.
export const H = {
  // Primary action — gold button
  primary:     "transition-[opacity,box-shadow] duration-150 hover:opacity-90 hover:shadow-md focus-visible:shadow-md",
  // Secondary — soft brand background tint on hover
  secondary:   "transition-colors duration-150 hover:bg-[color:var(--brand-soft)]",
  // Card / row that links to a detail view
  card:        "transition-[box-shadow,border-color,transform] duration-150 hover:shadow-md hover:border-[color:var(--c-border2)]",
  // Subtle row in a list (no shadow)
  row:         "transition-colors duration-150 hover:bg-black/[0.02]",
  // Icon button (inside a header / card actions)
  iconBtn:     "transition-colors duration-150 hover:bg-black/[0.06]",
  // Destructive action
  danger:      "transition-colors duration-150 hover:bg-red-50",
  // Link
  link:        "transition-opacity duration-150 hover:opacity-80",
} as const;
