/**
 * Sharkord Plugin UI-Kit — Design Tokens.
 *
 * One brand, one accent (Sharkord Teal). All plugins share these tokens so the
 * UI feels native and uniform across vid / stream / hero. Differentiation only
 * via icon + label, never via accent colour.
 *
 * Canonical source: sharkord-meta/templates/plugin-ui/. Vendored into each
 * plugin under src/ui/kit/.
 */

export const tokens = {
  /** Sharkord brand accent — identical for every plugin. */
  accent: "#00BFA5",
  accentTint: "rgba(0, 191, 165, 0.15)",
  accentBorder: "rgba(0, 191, 165, 0.35)",

  text: "rgba(255, 255, 255, 0.92)",
  textMuted: "rgba(255, 255, 255, 0.6)",
  textFaint: "rgba(255, 255, 255, 0.4)",

  surface: "rgba(0, 0, 0, 0.2)",
  surfaceRaised: "rgba(255, 255, 255, 0.04)",
  border: "rgba(255, 255, 255, 0.1)",

  danger: "#F44336",
  success: "#00BFA5",
  live: "#FF5252",

  radiusCard: "8px",
  radiusBadge: "6px",
  radiusButton: "6px",

  padCard: "16px",
  padBadge: "4px 10px",
  gap: "6px",

  fontSm: "12px",
  fontMd: "13px",
  fontLg: "14px",
} as const;

export type Tokens = typeof tokens;
