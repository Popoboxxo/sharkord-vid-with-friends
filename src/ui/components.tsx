/**
 * UI components for sharkord-vid-with-friends.
 *
 * Provides React components registered in Sharkord plugin slots:
 * - NowPlayingBadge: Small indicator in TOPBAR_RIGHT showing current video title
 * - QueuePanel: Queue overview panel for HOME_SCREEN slot
 *
 * Referenced by: REQ-017
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Types ----

/** Minimal props passed to plugin slot components by Sharkord */
type SlotComponentProps = {
  channelId?: number;
  [key: string]: unknown;
};

/**
 * Plugin component map by slot ID.
 * This matches the TPluginComponentsMapBySlotId expected by Sharkord.
 */
type ComponentsMap = Record<string, Array<() => JSX.Element | null>>;

// ---- Placeholder Components ----
// Note: These are minimal stubs. The real Sharkord UI library (@sharkord/ui)
// provides ShadCN-based components (Card, Button, Badge, etc.) at runtime.
// For now, we use basic JSX until the plugin SDK types are available.

/**
 * NowPlayingBadge — displays in TOPBAR_RIGHT slot.
 * Shows a small badge with the currently playing video title.
 * (REQ-017)
 */
const NowPlayingBadge = (): JSX.Element | null => {
  // In production this would read from a shared state (e.g., tRPC subscription or context)
  // For now, return a static placeholder that shows the plugin is loaded
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        opacity: 0.8,
      }}
    >
      <span role="img" aria-label="video">🎬</span>
      <span>Vid With Friends</span>
    </div>
  );
};

/**
 * QueuePanel — displays in HOME_SCREEN slot.
 * Shows queue overview and currently playing info.
 * (REQ-017)
 */
const QueuePanel = (): JSX.Element | null => {
  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
      }}
    >
      <h3
        style={{
          margin: "0 0 8px 0",
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        🎬 Vid With Friends
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: "12px",
          opacity: 0.6,
        }}
      >
        Join a voice channel and use <code>/watch</code> to start watching together.
      </p>
    </div>
  );
};

// ---- Export ----

/**
 * Component map registered via ctx.ui.registerComponents() or exported as `components`.
 * Slot IDs follow the Sharkord Plugin SDK conventions.
 */
export const components: ComponentsMap = {
  TOPBAR_RIGHT: [NowPlayingBadge],
  HOME_SCREEN: [QueuePanel],
};
