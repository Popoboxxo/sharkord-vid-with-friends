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

/**
 * SettingsPanel — displays in ADMIN_SETTINGS slot.
 * Provides comprehensive plugin configuration for video bitrate, audio bitrate,
 * default volume, sync mode, and debug output.
 * (REQ-018, REQ-026)
 */
const SettingsPanel = (): JSX.Element | null => {
  return (
    <div
      style={{
        padding: "20px",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <h2
        style={{
          margin: "0 0 16px 0",
          fontSize: "16px",
          fontWeight: 700,
          color: "rgba(255, 255, 255, 0.95)",
        }}
      >
        🎬 Video-Streaming Einstellungen
      </h2>

      {/* Settings Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "20px",
        }}
      >
        {/* Video Bitrate */}
        <div
          style={{
            borderLeft: "3px solid rgba(66, 133, 244, 0.6)",
            paddingLeft: "12px",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "6px",
            }}
          >
            Video-Bitrate
          </label>
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.55)",
              lineHeight: "1.4",
            }}
          >
            Kontroliert die Qualität und Dateigröße des Video-Streams. Höhere Werte verbessern die Qualität, erfordern aber mehr Bandbreite.
            <br />
            <strong>Empfohlen:</strong> 2500–4000 kbps für Standard-Qualität, 4000–6000 kbps für HD.
          </p>
          <input
            type="number"
            placeholder="z.B. 3000"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "4px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.9)",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              marginTop: "6px",
              fontSize: "10px",
              color: "rgba(255, 255, 255, 0.45)",
            }}
          >
            Einheit: kbps
          </div>
        </div>

        {/* Audio Bitrate */}
        <div
          style={{
            borderLeft: "3px solid rgba(156, 100, 226, 0.6)",
            paddingLeft: "12px",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "6px",
            }}
          >
            Audio-Bitrate
          </label>
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.55)",
              lineHeight: "1.4",
            }}
          >
            Bestimmt die Qualität des Audio-Streams. 128 kbps ist für die meisten Nutzer ausreichend, 192+ kbps für Audiophile.
            <br />
            <strong>Empfohlen:</strong> 128 kbps (Standard), 192 kbps (Hohe Qualität).
          </p>
          <input
            type="number"
            placeholder="z.B. 128"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "4px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.9)",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              marginTop: "6px",
              fontSize: "10px",
              color: "rgba(255, 255, 255, 0.45)",
            }}
          >
            Einheit: kbps
          </div>
        </div>

        {/* Default Volume */}
        <div
          style={{
            borderLeft: "3px solid rgba(52, 193, 100, 0.6)",
            paddingLeft: "12px",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "6px",
            }}
          >
            Standard-Lautstärke
          </label>
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.55)",
              lineHeight: "1.4",
            }}
          >
            Lautstärke beim Start eines neuen Videos. Diese Einstellung wird auf alle Zuschauer angewendet.
            <br />
            <strong>Empfohlen:</strong> 75 % — ausreichend laut und nicht überwältigend.
          </p>
          <input
            type="range"
            min="0"
            max="100"
            defaultValue="75"
            style={{
              width: "100%",
              marginBottom: "8px",
            }}
          />
          <div
            style={{
              fontSize: "10px",
              color: "rgba(255, 255, 255, 0.45)",
            }}
          >
            Bereich: 0–100 %
          </div>
        </div>

        {/* Sync Mode */}
        <div
          style={{
            borderLeft: "3px solid rgba(255, 152, 0, 0.6)",
            paddingLeft: "12px",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "6px",
            }}
          >
            Synchronisierungs-Modus
          </label>
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.55)",
              lineHeight: "1.4",
            }}
          >
            <strong>Server-Streaming:</strong> Video wird vom Server gestreamt, höchste Qualität und Zuverlässigkeit.
            <br />
            <strong>Client-Sync:</strong> Alle Clients spielen das YouTube-Video lokal ab mit Server-koordinierter Synchronisation.
            <br />
            <em>Client-Sync erfordert direkten YouTube-Zugriff auf Client-Seite.</em>
          </p>
          <select
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "4px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.9)",
              cursor: "pointer",
            }}
          >
            <option value="server">Server-Streaming (Standard)</option>
            <option value="client">Client-Sync (Hybrid)</option>
          </select>
        </div>

        {/* Debug Output */}
        <div
          style={{
            borderLeft: "3px solid rgba(244, 67, 54, 0.6)",
            paddingLeft: "12px",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "6px",
            }}
          >
            Debug-Ausgabe aktivieren
          </label>
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.55)",
              lineHeight: "1.4",
            }}
          >
            Aktiviert detailliertes Logging für Fehlerdiagnose und Entwicklung. Erfasst ffmpeg-Fehler, yt-dlp-Aufrufe, Stream-Prozesse und Exception-Details.
            <br />
            <strong>Warnung:</strong> Kann die Serverperformance leicht beeinträchtigen. Nur für Debugging verwenden.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <input
              type="checkbox"
              id="debug-output"
              style={{
                width: "16px",
                height: "16px",
                cursor: "pointer",
              }}
            />
            <label
              htmlFor="debug-output"
              style={{
                fontSize: "12px",
                color: "rgba(255, 255, 255, 0.75)",
                cursor: "pointer",
              }}
            >
              Detailliertes Logging aktivieren
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div
        style={{
          marginTop: "24px",
          paddingTop: "16px",
          borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "8px",
        }}
      >
        <button
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "4px",
            backgroundColor: "rgba(66, 133, 244, 0.8)",
            border: "1px solid rgba(66, 133, 244, 1)",
            color: "white",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(66, 133, 244, 1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(66, 133, 244, 0.8)";
          }}
        >
          💾 Einstellungen speichern
        </button>
      </div>
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
  ADMIN_SETTINGS: [SettingsPanel],
};
