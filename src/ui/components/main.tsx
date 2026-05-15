/**
 * Main/home-screen components for sharkord-vid-with-friends.
 *
 * Provides:
 * - QueuePanel: Queue overview panel for HOME_SCREEN slot
 *
 * Referenced by: REQ-017
 */

import type { JSX } from "react";

/**
 * QueuePanel — displays in HOME_SCREEN slot.
 * Shows queue overview and currently playing info.
 */
export const QueuePanel = (): JSX.Element | null => {
  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
      }}
    >
      <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600 }}>
        🎬 Vid With Friends
      </h3>
      <p style={{ margin: 0, fontSize: "12px", opacity: 0.6 }}>
        Join a voice channel and use <code>/watch</code> to start watching together.
      </p>
    </div>
  );
};
