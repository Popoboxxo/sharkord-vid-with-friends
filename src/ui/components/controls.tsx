/**
 * Control / settings components for sharkord-vid-with-friends.
 *
 * Provides:
 * - SettingsPanel: ADMIN_SETTINGS slot configuration UI
 *
 * Referenced by: REQ-018, REQ-026
 */

import type { JSX } from "react";

const containerStyle = {
  padding: "20px",
  borderRadius: "8px",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  fontFamily: "system-ui, -apple-system, sans-serif",
} as const;

const headerStyle = {
  margin: "0 0 16px 0",
  fontSize: "16px",
  fontWeight: 700,
  color: "rgba(255, 255, 255, 0.95)",
} as const;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "20px",
} as const;

const sectionStyle = (color: string) => ({
  borderLeft: `3px solid ${color}`,
  paddingLeft: "12px",
});

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "rgba(255, 255, 255, 0.9)",
  marginBottom: "6px",
} as const;

const descStyle = {
  margin: "0 0 10px 0",
  fontSize: "11px",
  color: "rgba(255, 255, 255, 0.55)",
  lineHeight: "1.4",
} as const;

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "12px",
  borderRadius: "4px",
  backgroundColor: "rgba(255, 255, 255, 0.08)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  color: "rgba(255, 255, 255, 0.9)",
  boxSizing: "border-box" as const,
};

const unitStyle = {
  marginTop: "6px",
  fontSize: "10px",
  color: "rgba(255, 255, 255, 0.45)",
} as const;

const selectStyle = {
  ...inputStyle,
  cursor: "pointer",
};

const saveBtnStyle = {
  padding: "8px 16px",
  fontSize: "12px",
  fontWeight: 600,
  borderRadius: "4px",
  backgroundColor: "rgba(66, 133, 244, 0.8)",
  border: "1px solid rgba(66, 133, 244, 1)",
  color: "white",
  cursor: "pointer",
  transition: "all 0.2s ease",
} as const;

/**
 * SettingsPanel — displays in ADMIN_SETTINGS slot.
 * Provides plugin configuration for video bitrate, audio bitrate,
 * default volume, sync mode, and debug output.
 */
export const SettingsPanel = (): JSX.Element | null => {
  return (
    <div style={containerStyle}>
      <h2 style={headerStyle}>🎬 Video-Streaming Einstellungen</h2>

      <div style={gridStyle}>
        {/* Video Bitrate */}
        <div style={sectionStyle("rgba(66, 133, 244, 0.6)")}>
          <label style={labelStyle}>Video-Bitrate</label>
          <p style={descStyle}>
            Kontrolliert die Qualität und Dateigröße des Video-Streams. Höhere Werte verbessern die Qualität, erfordern aber mehr Bandbreite.
            <br />
            <strong>Empfohlen:</strong> 2500–4000 kbps für Standard-Qualität, 4000–6000 kbps für HD.
          </p>
          <input type="number" placeholder="z.B. 3000" style={inputStyle} />
          <div style={unitStyle}>Einheit: kbps</div>
        </div>

        {/* Audio Bitrate */}
        <div style={sectionStyle("rgba(156, 100, 226, 0.6)")}>
          <label style={labelStyle}>Audio-Bitrate</label>
          <p style={descStyle}>
            Bestimmt die Qualität des Audio-Streams. 128 kbps ist für die meisten Nutzer ausreichend, 192+ kbps für Audiophile.
            <br />
            <strong>Empfohlen:</strong> 128 kbps (Standard), 192 kbps (Hohe Qualität).
          </p>
          <input type="number" placeholder="z.B. 128" style={inputStyle} />
          <div style={unitStyle}>Einheit: kbps</div>
        </div>

        {/* Default Volume */}
        <div style={sectionStyle("rgba(52, 193, 100, 0.6)")}>
          <label style={labelStyle}>Standard-Lautstärke</label>
          <p style={descStyle}>
            Lautstärke beim Start eines neuen Videos. Diese Einstellung wird auf alle Zuschauer angewendet.
            <br />
            <strong>Empfohlen:</strong> 75 % — ausreichend laut und nicht überwältigend.
          </p>
          <input type="range" min="0" max="100" defaultValue="75" style={{ width: "100%", marginBottom: "8px" }} />
          <div style={unitStyle}>Bereich: 0–100 %</div>
        </div>

        {/* Sync Mode */}
        <div style={sectionStyle("rgba(255, 152, 0, 0.6)")}>
          <label style={labelStyle}>Synchronisierungs-Modus</label>
          <p style={descStyle}>
            <strong>Server-Streaming:</strong> Video wird vom Server gestreamt, höchste Qualität und Zuverlässigkeit.
            <br />
            <strong>Client-Sync:</strong> Alle Clients spielen das YouTube-Video lokal ab mit Server-koordinierter Synchronisation.
            <br />
            <em>Client-Sync erfordert direkten YouTube-Zugriff auf Client-Seite.</em>
          </p>
          <select style={selectStyle}>
            <option value="server">Server-Streaming (Standard)</option>
            <option value="client">Client-Sync (Hybrid)</option>
          </select>
        </div>

        {/* Debug Output */}
        <div style={sectionStyle("rgba(244, 67, 54, 0.6)")}>
          <label style={labelStyle}>Debug-Ausgabe aktivieren</label>
          <p style={descStyle}>
            Aktiviert detailliertes Logging für Fehlerdiagnose und Entwicklung. Erfasst ffmpeg-Fehler, yt-dlp-Aufrufe, Stream-Prozesse und Exception-Details.
            <br />
            <strong>Warnung:</strong> Kann die Serverperformance leicht beeinträchtigen. Nur für Debugging verwenden.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input type="checkbox" id="debug-output" style={{ width: "16px", height: "16px", cursor: "pointer" }} />
            <label htmlFor="debug-output" style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.75)", cursor: "pointer" }}>
              Detailliertes Logging aktivieren
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <button
          style={saveBtnStyle}
          onMouseEnter={(e: any) => { (e.currentTarget as any).style.backgroundColor = "rgba(66, 133, 244, 1)"; }}
          onMouseLeave={(e: any) => { (e.currentTarget as any).style.backgroundColor = "rgba(66, 133, 244, 0.8)"; }}
        >
          💾 Einstellungen speichern
        </button>
      </div>
    </div>
  );
};
