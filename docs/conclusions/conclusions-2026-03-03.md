# Erkenntnisse — 03. März 2026

## Session-Zusammenfassung
Vollständiger REQ-Audit (REQ-001 bis REQ-033) gegen den aktuellen Codebestand mit gezielter Nachimplementierung identifizierter Lücken. Fokus auf Must- und unmittelbar umsetzbare Should-Requirements.

---

## 1. Umgesetzte Lücken

### REQ-002 (Must) — Video-Codec Konformität
- RTP-Video-Pfad auf **H264** umgestellt (`libx264`) statt VP8.
- Mediasoup Video-Producer auf `video/H264` mit passenden Codec-Parametern gesetzt.
- Unit-Tests für `ffmpeg` und `stream-manager` auf H264 angepasst.

### REQ-018-A/B/C (Should) — Settings Defaults & Validierung
- `videoBitrate`/`audioBitrate` in `onLoad` als numerische Settings mit Min/Max registriert.
- Defaults auf REQ-konforme Werte gesetzt:
  - Video: `3000`
  - Audio: `128`
  - Volume: `75`
- Bitraten werden in `startStream` sauber zu `"<wert>k"` normalisiert.

### REQ-028-B / REQ-028-C (Should)
- Stream wird initial mit Vorbereitungstitel erstellt (`⏳ Wird vorbereitet… — Titel`).
- Timeout-Warnung nach 30s ohne Streaming-Signal inkl. Titel-Update (`⚠ Vorbereitung dauert ungewöhnlich lange ...`).

### REQ-029 / REQ-030 / REQ-031 (UI Controls)
- `NowPlayingBadge` mit funktionaler Command-Bridge versehen:
  - Pause/Resume → `/pause`
  - Stop → `/watch_stop`
  - Skip (nur bei Queue > 1 sichtbar) → `/skip`
- Optionaler Vorbereitungsstatus (Phase + Fortschrittsbalken) in der Badge ergänzt.

### REQ-033 (Should)
- `/debug_cache` ist jetzt nur nutzbar, wenn `debugMode=true` aktiv ist.

---

## 2. Tests & Verifikation

### Erfolgreiche Testläufe
- `bun run test:unit` ✅ (110 pass)
- `bun run test:integration` ✅ (18 pass)

### Neu/angepasste Tests
- `index-onload.test.ts`: Settings-Definitionen für REQ-018-A/B/C (Typ, Default, Grenzen).
- `commands.test.ts`: `/debug_cache` Debug-Mode-Gating (REQ-033).
- Anpassungen bestehender Tests auf neue Defaults/Codec.

---

## 3. Doku-Synchronisierung

### Aktualisierte Dateien
- `docs/CODEBASE_OVERVIEW.md`
  - H264-Pfad dokumentiert
  - UI-Command-Bridge dokumentiert
  - Debug-Cache-Gating dokumentiert
  - Settings-Defaults aktualisiert

### Geprüfte Dateien
- `docs/REQUIREMENTS.md` geprüft, keine textliche Anpassung erforderlich.

---

## 4. Wichtige Links/Referenzen
- Code-Entry: `src/index.ts`
- Codec/ffmpeg: `src/stream/ffmpeg.ts`, `src/stream/stream-manager.ts`, `src/utils/constants.ts`
- UI-Bridge: `src/ui/components.tsx`
- Debug-Cache Command: `src/commands/debug_cache.ts`
- Tests: `tests/unit/commands.test.ts`, `tests/unit/ffmpeg.test.ts`, `tests/unit/stream-manager.test.ts`, `tests/integration/index-onload.test.ts`

---

## 5. Offene Punkte / nächste sinnvolle Schritte
- Runtime-spezifische Verifizierung der UI-Command-Bridge in echter Sharkord-Umgebung (Host muss Bridge bereitstellen).
- Optional: explizite REQ-Audit-Tabelle (REQ → Codepfad → Testfall) als separates Dokument für Review/Audit.

---

## 6. Nachtrag — Audio-Stream Fehleranalyse (RTP Payload)

### Beobachtung
- Fehlerbild im Runtime-Log: `Packet size 1276 too large for max RTP payload size 1188` mit anschließendem Audio-ffmpeg Exit-Code `234`.
- Der Fehler trat im Opus-Audiopfad auf, während Video weiterlief.

### Root Cause
- Bei `pkt_size=1200` sind effektiv nur ~1188 Byte RTP-Payload verfügbar.
- Der Opus-Encoder konnte mit bisherigen Defaults zu große Einzelpakete erzeugen (u.a. bei höherer Audio-Bitrate wie `256k`).

### Umsetzung (REQ-002)
- In `buildAudioStreamArgs()` wurden RTP-sichere Opus-Encodergrenzen ergänzt:
  - `-frame_duration 20`
  - `-vbr off`
- Dadurch bleiben Opus-Payloads stabil unter dem RTP-Limit und der Muxer-Fehler tritt nicht mehr auf.

### Verifikation
- TDD durchgeführt:
  - Neuer Unit-Test `[REQ-002] should enforce RTP-safe Opus packet sizing`
  - Erst rot, nach Implementierung grün.
- Gesamte Unit-Suite erneut grün:
  - `bun run test:unit` ✅ (111 pass)

---

## 7. Nachtrag — Command-State-Desync + Audioqualität

### Problem A: `/skip`, `/pause`, `/watch_stop` melden fälschlich „Nothing is currently playing."
- Ursache: Commands prüften ausschließlich `syncController.isPlaying(channelId)`.
- Bei kurzem Desync zwischen Sync-State und real aktivem Stream (`streamManager.isActive`) wurden valide Aktionen blockiert.

### Fix A (REQ-008, REQ-010, REQ-013)
- `skip.ts`: Fallback auf `streamManager?.isActive(channelId)` ergänzt.
- `stop.ts`: Fallback auf `streamManager?.isActive(channelId)` ergänzt.
- `pause.ts`: Fallback auf `streamControl?.isActive(channelId)` ergänzt.
- `index.ts`: `registerSkipCommand(...)` erhält jetzt `streamManager`.

### Problem B: Sehr schlechte/übersteuerte Audioqualität
- Ursache: Lautstärke wurde als Prozentwert (z. B. `75`) direkt an ffmpeg-Filter übergeben statt als Faktor (`0.75`).
- Effekt: massive Verstärkung/Clipping, subjektiv „extrem schlechte" Audioqualität.

### Fix B (REQ-012)
- In `index.ts` wird vor dem Audio-Spawn nun `normalizeVolume(...)` angewendet und der normalisierte Wert an ffmpeg übergeben.

### Verifikation
- Neue Unit-Tests für Command-Fallbacks (State-Desync) hinzugefügt.
- Gesamttests grün:
  - `bun run test:unit` ✅ (114 pass)
  - `bun run test:integration` ✅ (18 pass)
