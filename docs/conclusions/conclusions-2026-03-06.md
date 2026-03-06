# Erkenntnisse — 6. März 2026

## Session-Zusammenfassung
Fix für vorzeitiges Video-/Audio-Ende und A/V-Asynchronität im progressiven Streaming-Pfad (REQ-038).
Root-Cause über Loganalyse identifiziert, TDD umgesetzt, Build + Tests vollständig grün.

---

## 1. Root-Cause aus Loganalyse

### Beobachtungen aus `debug-cache/toAnalyze-log`
- Audio-ffmpeg endet früh mit Exit Code 0 (normal), deutlich vor Videodauer.
- Video-ffmpeg endet ebenfalls früh mit Exit Code 0.
- Beide Prozesse beenden sich ohne Crash, aber asynchron zueinander.
- Audio-yt-dlp zeigt Post-Processing via ffmpeg (`-f mp4 -movflags +faststart`) auf laufender Temp-Datei.

### Schlussfolgerung
- Temp-Datei-Endung passte nicht zuverlässig zum gelockten Format (`formatId`).
- Dadurch konnte yt-dlp remuxen/rename durchführen, während ffmpeg bereits liest.
- Ergebnis: vorzeitiges EOF im ffmpeg-Leseprozess und A/V-Drift bzw. frühes Ende.

---

## 2. Implementierter Fix (REQ-038)

### Änderungen in `src/stream/ffmpeg.ts`
- Neue Helper-Funktion: `inferTempExtension(streamType, formatId, progressiveVideoMode)`
  - Audio: `140 -> m4a`, `249/250/251/171/172 -> webm`
  - Video: bei gelocktem Format standardisiert `mp4`, bei progressivem ungelocktem Fallback `ts`
- `buildTempFilePath(...)` erweitert um optionale Extension für beide Streamtypen.
- `spawnFfmpeg(...)` nutzt jetzt die formatbasierte Temp-Extension.
- `buildYtDlpDownloadCmd(...)` setzt `--hls-use-mpegts` nur noch für Video **ohne** expliziten `formatId`-Lock.

### Erwarteter Effekt
- Weniger yt-dlp-Postprocessing auf bereits von ffmpeg geöffneter Temp-Datei.
- Stabilerer progressiver Pfad ohne vorzeitiges Stream-Ende.
- Bessere A/V-Kohärenz über die Laufzeit.

---

## 3. Tests (TDD)

### Neu/angepasst in `tests/unit/ffmpeg.test.ts`
- `[REQ-038] should NOT enable mpegts output hint when explicit formatId is locked`
- `[REQ-038] should enable mpegts output hint when no explicit formatId is provided`
- `[REQ-038] should use m4a temp extension for AAC formatId 140`
- `[REQ-038] should use webm temp extension for Opus formatId 251`
- `[REQ-038] should use mp4 temp extension for locked H264 formatId 137`

### Verifikation
- `bun test tests/unit/ffmpeg.test.ts` -> 32 pass, 0 fail
- `bun test` -> 164 pass, 0 fail
- `bun run build` -> erfolgreich

---

## 4. Doku-Zyklus

### Aktualisiert
- `docs/CODEBASE_OVERVIEW.md`
  - Stand auf 06.03.2026
  - neue ffmpeg-Helper/Signaturen dokumentiert
  - Stabilitätslogik (`inferTempExtension`, mpegts-Regel) ergänzt

### Geprüft
- `docs/REQUIREMENTS.md`: keine neue REQ-ID erforderlich; Fix ist durch REQ-038 abgedeckt.
- `.github/agents/vid-with-friends.agent.md`: Regeln geprüft, keine Anpassung nötig.

---

## 5. Wichtige Referenzen
- Loganalyse: `debug-cache/toAnalyze-log`
- Implementierung: `src/stream/ffmpeg.ts`
- Tests: `tests/unit/ffmpeg.test.ts`
- Architektur-Doku: `docs/CODEBASE_OVERVIEW.md`

---

## 6. Nachtrag: Audio-Download-Abbruch trotz REQ-038-Fix

### Neue Beobachtung
- Bei einzelnen Videos schlug Audio-Download mit `formatId=140` fehl:
  - `ERROR: Requested format is not available`
  - Folge: Audio-Temp-Datei blieb leer, Start brach nach 30s ab.

### Ursache
- Resolve-Phase liefert `audioFormatId`, aber beim spaeteren Download kann die verfuegbare Formatliste variieren.
- Ein harter Format-Lock kann dadurch sporadisch ungueltig werden.

### Umgesetzter Fix
- Neuer Retry-Mechanismus in `spawnFfmpeg(...)`:
  - Erster Versuch weiterhin mit `formatId` (bevorzugter Lock)
  - Bei Fehler `Requested format is not available` genau ein Retry ohne `formatId`
- Neue Helper-Funktion: `shouldRetryWithoutFormatId(exitCode, stderrText, formatId)`

### REQ-Update
- `docs/REQUIREMENTS.md` erweitert um **REQ-027-D**:
  - Format-Lock Fallback bei yt-dlp Downloadfehlern

### Verifikation
- `bun test tests/unit/ffmpeg.test.ts` -> 36 pass, 0 fail
- `bun test` -> 168 pass, 0 fail
- `bun run build` + Docker Restart erfolgreich

---

## 7. Nachtrag: FullDownloadMode spielte zu schnell

### Befund aus Docker-Logs
- Bei `fullDownloadMode=true` wurde `-re flag: OFF (complete file)` geloggt.
- ffmpeg Progress zeigte deutlich erhoehte Geschwindigkeit:
  - Video etwa `3.6x` bis `4.0x`
  - Audio etwa `21x` bis `24x`

### Ursache
- `fullDownloadMode` war fälschlich an `-re OFF` gekoppelt.
- Dadurch wurde die Datei so schnell wie möglich encodiert statt in Echtzeit gepaced.

### Fix
- `spawnFfmpeg(...)` nutzt jetzt fuer beide Modi Echtzeit-Pacing (`useRealtimeReading = true`).
- `fullDownloadMode` steuert nur noch den Startzeitpunkt (vollstaendiger Download vor Start), nicht die Playback-Geschwindigkeit.
- Logtext aktualisiert auf `-re flag: ON (paced realtime playback)`.

### Zusatz-Hardening
- Fallback-Trigger erweitert: Bei `exit code 1` mit leerem stderr und gesetztem `formatId` erfolgt ebenfalls ein einmaliger Retry ohne Format-Lock (REQ-027-D).

### Verifikation
- `bun test tests/unit/ffmpeg.test.ts` -> 38 pass, 0 fail
- `bun test` -> 170 pass, 0 fail
