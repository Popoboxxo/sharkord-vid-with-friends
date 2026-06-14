/**
 * Sharkord Plugin UI-Kit — shared primitives.
 *
 * Inline-styled (no Tailwind assumption) so the same look renders identically in
 * every plugin. One accent (teal). Canonical source:
 * sharkord-meta/templates/plugin-ui/.
 */

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "./tokens";

type WithChildren = { children?: ReactNode; style?: CSSProperties };

/** Small status pill for the TOPBAR_RIGHT slot. */
export function Badge({
  icon,
  children,
  tone = "accent",
}: {
  icon?: ReactNode;
  children?: ReactNode;
  tone?: "accent" | "live" | "muted";
}) {
  const bg = tone === "live" ? "rgba(255,82,82,0.15)" : tone === "muted" ? tokens.surfaceRaised : tokens.accentTint;
  const border = tone === "live" ? "rgba(255,82,82,0.35)" : tone === "muted" ? tokens.border : tokens.accentBorder;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: tokens.gap,
        padding: tokens.padBadge,
        borderRadius: tokens.radiusBadge,
        fontSize: tokens.fontSm,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color: tokens.text,
        maxWidth: "260px",
      }}
    >
      {icon != null && <span style={{ fontSize: tokens.fontLg, lineHeight: 1 }}>{icon}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
}

/** Solid dot indicator (e.g. live state). */
export function StatusDot({ color = tokens.accent, pulse }: { color?: string; pulse?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: color,
        boxShadow: pulse ? `0 0 0 3px ${color}33` : undefined,
      }}
    />
  );
}

/** Card container for the HOME_SCREEN slot. */
export function Card({ title, icon, children, style }: { title?: ReactNode; icon?: ReactNode } & WithChildren) {
  return (
    <div
      style={{
        padding: tokens.padCard,
        borderRadius: tokens.radiusCard,
        border: `1px solid ${tokens.border}`,
        backgroundColor: tokens.surface,
        marginBottom: "12px",
        color: tokens.text,
        ...style,
      }}
    >
      {title != null && (
        <h3 style={{ margin: "0 0 8px 0", fontSize: tokens.fontLg, fontWeight: 600, display: "flex", alignItems: "center", gap: tokens.gap }}>
          {icon != null && <span>{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

/** Primary/secondary text button. */
export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const styles: Record<string, CSSProperties> = {
    primary: { backgroundColor: tokens.accent, color: "#06231f", border: "none" },
    ghost: { backgroundColor: "transparent", color: tokens.text, border: `1px solid ${tokens.border}` },
    danger: { backgroundColor: "transparent", color: tokens.danger, border: `1px solid rgba(244,67,54,0.4)` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: "6px 12px",
        borderRadius: tokens.radiusButton,
        fontSize: tokens.fontMd,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** Compact icon button for the CHAT_ACTIONS slot. */
export function IconButton({ icon, title, onClick }: { icon: ReactNode; title?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusButton,
        color: tokens.text,
        cursor: "pointer",
        padding: "4px 8px",
        fontSize: tokens.fontLg,
        lineHeight: 1,
      }}
    >
      {icon}
    </button>
  );
}

/** Full-screen panel wrapper for the FULL_SCREEN slot. */
export function Panel({ title, icon, children }: { title?: ReactNode; icon?: ReactNode } & WithChildren) {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "24px", color: tokens.text }}>
      {title != null && (
        <h2 style={{ margin: "0 0 16px 0", fontSize: "20px", fontWeight: 700, display: "flex", alignItems: "center", gap: tokens.gap }}>
          {icon != null && <span>{icon}</span>}
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

/** Simple list of rows. */
export function List({ items, empty }: { items: ReactNode[]; empty?: ReactNode }) {
  if (items.length === 0) {
    return <div style={{ fontSize: tokens.fontSm, color: tokens.textFaint }}>{empty ?? "Nothing here yet."}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: "8px 10px",
            borderRadius: tokens.radiusButton,
            backgroundColor: tokens.surfaceRaised,
            fontSize: tokens.fontMd,
          }}
        >
          {it}
        </div>
      ))}
    </div>
  );
}

export { tokens };
