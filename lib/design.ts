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

  // ── Series palette (cohesive SWL navy/gold/green for line + bar charts).
  // Reserved for the trend/decay/comparison surfaces so charts feel like
  // they belong to the same product, not a stock template. Use seriesPositive
  // for positives/wins, seriesReplies for engagement, seriesSent for volume. */
  // Trend palette — boss feedback round 4 #5 ("elegí mejores colores").
  // Each color encodes the metric's *meaning*: sky blue = raw volume
  // (cool, neutral), gold = engagement/replies (warm, SWL-signature),
  // green = positive outcome. Navy was too close to the panel header
  // and made the volume line invisible against the dark theme.
  seriesSent:     "#38BDF8",   // sky 400 — volume baseline
  seriesReplies:  "#c9a83a",   // SWL gold — engagement
  seriesPositive: "#10B981",   // green — outcome

  // ── Legacy aliases (for components not yet migrated) ──
  cyan:           "#0A66C2",
  cyanGlow:       "rgba(10,102,194,0.1)",
  greenGlow:      "#ECFDF5",
  redGlow:        "#FEF2F2",
  yellowGlow:     "#FFFBEB",
} as const;

export type Color = typeof C;

// ── Typography scale (Inter body, Outfit headings) ──────────────────────────
// Single source of truth so every page uses the same rhythm. Six visual
// levels: hero (display number on a stat card), display (chapter title),
// sectionTitle (panel header), cardTitle (sub-panel), body, label, meta.
// Naming follows the visual hierarchy, not pixel sizes, so the scale can be
// re-tuned without rewriting components.
export const T = {
  hero:        "text-[44px] sm:text-[52px] leading-[0.95] font-bold tracking-[-0.03em]",
  display:     "text-[26px] sm:text-[30px] leading-[1.05] font-bold tracking-[-0.022em]",
  pageTitle:   "text-[28px] leading-[1.1] font-bold tracking-[-0.02em]",
  sectionTitle:"text-[18px] leading-tight font-semibold tracking-[-0.015em]",
  cardTitle:   "text-[14px] font-semibold tracking-[-0.005em]",
  body:        "text-[13.5px] leading-[1.55]",
  bodyMuted:   "text-[13.5px] leading-[1.55] text-[color:var(--c-textMuted)]",
  label:       "text-[10px] font-bold tracking-[0.18em] uppercase",
  metaSmall:   "text-[11px] leading-tight",
  mono:        "text-[12.5px] font-medium tabular-nums",
  numHero:     "text-[52px] font-bold tabular-nums leading-none tracking-[-0.03em]",
  numLg:       "text-[28px] font-bold tracking-tight tabular-nums",
  numMd:       "text-[20px] font-semibold tabular-nums",
} as const;

// ── Dark contrast palette (navy) — the structural counterpoint to gold ─────
// Used for accent strips, chapter eyebrows, dark badges, and the "data
// section" surfaces where we want gold to *pop*. Always pair gold with N.ink
// (text on gold) or N.stripe (background behind gold) — never gold-on-light
// without a dark anchor nearby. Empirically this is what makes the dashboard
// feel like SWL, not a stock Tailwind kit.
export const N = {
  ink:        "#0B0F1A",   // deepest navy — text on gold, hero number backgrounds
  ink2:       "#111827",   // primary navy — chapter strips, dark badges
  ink3:       "#1F2A44",   // standard navy — dark surfaces, line baseline
  stripe:     "#2A3654",   // softer navy — secondary dark surfaces / dividers
  hairline:   "#3B486B",   // navy hairline for borders on dark backgrounds
  // Gold-on-dark text color — readable on N.ink / N.ink2.
  goldOnDark: "#E6C661",
} as const;

// ── Border radius scale (use these instead of ad-hoc rounded-* classes) ────
// Three sizes only: small interactive (chips, inline buttons), medium
// surfaces (inputs, cards), large containers (modal-style surfaces, top-level
// cards). Migration target — new components must use these; old components
// can use rounded-md/rounded-lg/rounded-2xl directly until a sweep.
//   R.sm  → 6px  → rounded-md
//   R.md  → 10px → rounded-[10px]
//   R.lg  → 16px → rounded-2xl
export const R = {
  sm: "rounded-md",
  md: "rounded-[10px]",
  lg: "rounded-2xl",
} as const;

// ── Text grays (3-level system) ─────────────────────────────────────────────
// Canonical hierarchy going forward. Maps onto the underlying 4-level CSS
// vars so existing code stays correct, but new components should pick from:
//   TX.primary    → main copy (titles, key data)
//   TX.secondary  → labels, helper text, less emphasis
//   TX.tertiary   → metadata, timestamps, the most muted lane
// (C.textPrimary / textBody / textMuted / textDim still exist for migration.)
export const TX = {
  primary:    "var(--c-textPrimary)",
  secondary:  "var(--c-textMuted)",
  tertiary:   "var(--c-textDim)",
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
