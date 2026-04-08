// SWL Brand tokens — single source of truth
export const C = {
  // Backgrounds
  bg:       "#060a14",
  surface:  "#0d1424",
  card:     "#111a2e",
  cardHov:  "#16213a",
  border:   "#1f3050",
  border2:  "#2a3f60",

  // Brand
  gold:     "#c9a83a",
  goldDim:  "#8c7225",
  goldGlow: "rgba(201,168,58,0.15)",
  cyan:     "#00e5ff",
  cyanGlow: "rgba(0,229,255,0.11)",

  // Semantic
  green:    "#3ddc84",
  greenGlow:"rgba(61,220,132,0.13)",
  red:      "#ff5f5f",
  redGlow:  "rgba(255,95,95,0.13)",
  yellow:   "#f5c842",
  yellowGlow:"rgba(245,200,66,0.13)",

  // Text
  textPrimary: "#e6eaf4",
  textBody:    "#9aa3b8",
  textMuted:   "#4e5a72",
  textDim:     "#2a3348",
} as const;

export type Color = typeof C;
