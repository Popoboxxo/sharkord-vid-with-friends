# Erkenntnisse — 07. Marz 2026

## Session-Zusammenfassung
Bugfix fuer vorzeitige Stream-Abbrueche im progressiven Modus (`fullDownloadMode=false`) ohne Rueckfall auf Voll-Download.

---

## 1. Progressive Mode Stabilitaet

### Ursache
- Harter `formatId`-Lock (`-f 137/140`) in progressivem Download konnte zu vorzeitig endenden ffmpeg-Streams fuehren.
- Temp-Dateien waren lesbar, aber Stream endete vor erwarteter Gesamtdauer.

### Loesung
- Neuer Policy-Helper: `shouldUseLockedFormatId(waitForFullDownload)`.
- `fullDownloadMode=true`: Lock bleibt aktiv.
- `fullDownloadMode=false`: Kein harter Lock, adaptive yt-dlp Auswahl.
- Progressive Temp-Container angepasst:
- Video ohne Lock: `.ts`
- Audio ohne Lock: `.webm`

### Wichtige Referenzen
- `src/stream/ffmpeg.ts`
- `tests/unit/ffmpeg.test.ts`

## 2. Laengen-Logging fuer Diagnose

### Umsetzung
- `spawnFfmpeg` akzeptiert `expectedDurationSeconds`.
- ffmpeg-Parser loggt:
- erkannte Input-Dauer (`Duration: ...`)
- gestreamte Dauer aus Progress (`time=...`)
- End-Summary mit `expected`, `input`, `streamed`.

### Wichtige Referenzen
- `src/stream/ffmpeg.ts`
- `src/index.ts`

## 3. Doku-Synchronisierung
- `docs/REQUIREMENTS.md` REQ-038 praezisiert (progressiver Modus ohne harten Format-Lock + Laengen-Logs).
- `docs/CODEBASE_OVERVIEW.md` mit neuem Streaming-Verhalten aktualisiert.

## 4. Track-Sync und Freeze-Schutz

### Umsetzung
- Beide Tracks laden nun parallel und melden `ready`.
- ffmpeg-Start erfolgt erst nach gemeinsamem Sync-Start-Signal (Start-Barrier), damit Audio/Video zeitgleich anlaufen (REQ-003).
- Endet ein Track vorzeitig, wird der Gegen-Track kontrolliert beendet und Auto-Advance sofort ausgeloest, um Video-Freeze mit weiterlaufendem Audio zu vermeiden (REQ-009).

### Wichtige Referenzen
- `src/index.ts`
- `src/stream/ffmpeg.ts`
