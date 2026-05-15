/**
 * Display components for sharkord-vid-with-friends.
 *
 * Provides:
 * - NowPlayingBadge: Small indicator in TOPBAR_RIGHT showing current video title
 *
 * Referenced by: REQ-017
 */

import type { JSX } from "react";

// ---- Types ----

/** Minimal props passed to plugin slot components by Sharkord */
type SlotComponentProps = {
  channelId?: number;
  isPaused?: boolean;
  queueSize?: number;
  nowPlayingTitle?: string;
  preparationPhase?: "RESOLVING" | "PREPARING" | "BUFFERING" | "STREAMING";
  preparationProgress?: number;
  executeCommand?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  [key: string]: unknown;
};

type SharkordCommandBridge = {
  executeCommand?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const toFiniteProgress = (value: unknown): number => {
  const progress = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
};

const resolveCommandExecutor = (
  props: SlotComponentProps
): ((name: string, args?: Record<string, unknown>) => Promise<unknown>) | null => {
  if (typeof props.executeCommand === "function") {
    return props.executeCommand;
  }
  if (typeof globalThis !== "undefined") {
    const bridge = (globalThis as unknown as { sharkord?: SharkordCommandBridge }).sharkord;
    if (typeof bridge?.executeCommand === "function") {
      return bridge.executeCommand;
    }
  }
  return null;
};

const runVoiceCommand = async (
  props: SlotComponentProps,
  commandName: string,
  args: Record<string, unknown> = {}
): Promise<void> => {
  const execute = resolveCommandExecutor(props);
  if (!execute) return;
  await execute(commandName, args);
};

const withButtonHover = (target: unknown, hovered: boolean): void => {
  const candidate = target as { style?: { backgroundColor: string; borderColor: string } } | null;
  if (!candidate?.style) return;
  candidate.style.backgroundColor = hovered ? "rgba(255, 255, 255, 0.15)" : "transparent";
  candidate.style.borderColor = hovered ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.2)";
};

const withStopButtonHover = (target: unknown, hovered: boolean): void => {
  const candidate = target as { style?: { backgroundColor: string; borderColor: string } } | null;
  if (!candidate?.style) return;
  candidate.style.backgroundColor = hovered ? "rgba(244, 67, 54, 0.15)" : "transparent";
  candidate.style.borderColor = hovered ? "rgba(244, 67, 54, 0.7)" : "rgba(244, 67, 54, 0.4)";
};

const btnStyle = {
  background: "none",
  border: "1px solid rgba(255, 255, 255, 0.2)",
  borderRadius: "4px",
  color: "rgba(255, 255, 255, 0.8)",
  cursor: "pointer",
  padding: "2px 6px",
  fontSize: "12px",
  lineHeight: 1,
  transition: "all 0.15s ease",
} as const;

/**
 * NowPlayingBadge — displays in TOPBAR_RIGHT slot.
 * Shows a small badge with the currently playing video title
 * and playback control buttons. (REQ-017, REQ-029, REQ-030, REQ-031)
 */
export const NowPlayingBadge = (props: SlotComponentProps): JSX.Element | null => {
  const currentlyPaused = props.isPaused === true;
  const queueSize = typeof props.queueSize === "number" ? props.queueSize : 0;
  const canSkip = queueSize > 1;
  const title = typeof props.nowPlayingTitle === "string" && props.nowPlayingTitle.trim()
    ? props.nowPlayingTitle
    : "Vid With Friends";

  const phase = props.preparationPhase;
  const progress = toFiniteProgress(props.preparationProgress);
  const showPreparation = phase !== undefined && phase !== "STREAMING";
  const phaseLabelMap: Record<string, string> = {
    RESOLVING: "Video wird aufgelöst…",
    PREPARING: "Download wird vorbereitet…",
    BUFFERING: "Stream wird gestartet…",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "12px",
        backgroundColor: "rgba(0, 0, 0, 0.15)",
      }}
    >
      <span role="img" aria-label="video" style={{ fontSize: "14px" }}>🎬</span>
      <span style={{ opacity: 0.8, maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>

      {showPreparation && (
        <div style={{ display: "flex", flexDirection: "column", minWidth: "140px", gap: "2px" }}>
          <span style={{ fontSize: "10px", opacity: 0.9 }}>
            {phaseLabelMap[phase] ?? "Vorbereitung…"}
          </span>
          <div style={{ width: "100%", height: "4px", borderRadius: "999px", backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", backgroundColor: "rgba(66, 133, 244, 0.9)" }} />
          </div>
        </div>
      )}

      <button
        title={currentlyPaused ? "Fortsetzen" : "Pause"}
        style={btnStyle}
        onClick={() => { void runVoiceCommand(props, "pause"); }}
        onMouseEnter={(e: any) => withButtonHover(e.currentTarget, true)}
        onMouseLeave={(e: any) => withButtonHover(e.currentTarget, false)}
      >
        {currentlyPaused ? "▶" : "⏸"}
      </button>

      {canSkip && (
        <button
          title="Nächstes Video"
          style={btnStyle}
        onClick={() => { void runVoiceCommand(props, "skip"); }}
        onMouseEnter={(e: any) => withButtonHover(e.currentTarget, true)}
        onMouseLeave={(e: any) => withButtonHover(e.currentTarget, false)}
        >
          ⏭
        </button>
      )}

      <button
        title="Stream beenden"
        style={{
          ...btnStyle,
          border: "1px solid rgba(244, 67, 54, 0.4)",
          color: "rgba(244, 67, 54, 0.9)",
        }}
        onClick={() => { void runVoiceCommand(props, "watch_stop"); }}
        onMouseEnter={(e: any) => withStopButtonHover(e.currentTarget, true)}
        onMouseLeave={(e: any) => withStopButtonHover(e.currentTarget, false)}
      >
        ⏹
      </button>
    </div>
  );
};
