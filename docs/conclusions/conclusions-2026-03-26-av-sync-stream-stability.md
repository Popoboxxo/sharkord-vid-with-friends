# Erkenntnisse — 26. März 2026

## Session-Zusammenfassung

Branch `fix/av-sync-stream-stability`: Debugging und Behebung von vier zusammenhängenden Bugs
rund um AV-Synchronisation und Stream-Stabilität im RTP-Streaming-Pfad. Kernproblem war, dass
ffmpeg zu früh auf einem unvollständigen Temp-File startete (Premature EOF) und dass das
`-re`-Flag ohne vollständiges Verständnis seiner Funktion entfernt worden war, was zu
massivem Speed-Overflow führte. Zusätzlich entstand im Full-Download-Modus ein konstanter
~600ms AV-Drift durch unterschiedliche libx264-Initialisierungszeiten.

---

## 1. Bug: Premature Stream EOF (REQ-044)

### Symptom

Stream bricht nach ~26 Sekunden ab, obwohl das Video 1403 Sekunden lang ist.
ffmpeg beendet sich mit Exit Code 0. Anschließend schlägt der Watchdog-Retry fehl,
weil `onEnd` die Queue bereits geleert hat.

### Root Cause

Der Progressive Mode startete ffmpeg bereits nach Erreichen des 10-MB-Buffer-Schwellenwerts.
ffmpeg las die Temp-Datei mit `-re` (1x Abspielgeschwindigkeit). yt-dlp schrieb währenddessen
noch weiter in dieselbe Datei. ffmpeg traf auf das aktuelle EOF der noch unvollständigen Datei
und beendete sich mit Exit Code 0 — kein Fehler aus ffmpeg-Sicht.

**Beweisführung durch Logs:**
```
[VIDEO] [FFmpeg Length] End summary: expected=1403s, input=1403s, streamed=26.4s
[VIDEO] [yt-dlp] Download completed (exit 0) — file size: 498091 KB  ← 2s NACH ffmpeg exit!
```

yt-dlp beendet sich 2 Sekunden nach ffmpeg. Das zeigt eindeutig: ffmpeg hat das EOF der
noch wachsenden Datei getroffen, nicht das echte Dateiende.

### Fix (REQ-044-B)

In `spawnFfmpeg` (`src/stream/ffmpeg.ts`): Nach dem 10-MB-Buffer-Threshold wird jetzt auf den
vollständigen yt-dlp-Abschluss gewartet (max. 120 Sekunden Timeout). ffmpeg startet erst,
wenn die Datei komplett ist.

```
Progressive Mode vorher:
  10 MB Buffer erreicht → ffmpeg startet sofort → trifft EOF der wachsenden Datei

Progressive Mode nachher:
  10 MB Buffer erreicht → warte auf yt-dlp Exit (max. 120s) → ffmpeg startet auf vollständiger Datei
```

Da die Datei nun immer vollständig ist, wenn ffmpeg startet, werden für Progressive Mode
dieselben AV-Sync-Flags wie im Full-Download-Modus gesetzt (`fullDownloadModePassed = true`).

### Relevante Code-Referenz

- `src/stream/ffmpeg.ts`, Zeilen ~716–779: Progressive-Mode Buffer & Wait-Logik
- `src/stream/ffmpeg.ts`, Zeile ~829: `fullDownloadModePassed = !useDirectVideoInput ? true : waitForFullDownload`

---

## 2. Bug: Video läuft mit 24–26x Geschwindigkeit (REQ-043)

### Symptom

```
[AUDIO] [FFmpeg Progress] time=00:00:12.00, speed=24x
[VIDEO] [FFmpeg Progress] frame=27, time=00:00:01.08, speed=2.16x
[av-sync] WARNING: AV drift 449420ms (audio=525.34s, video=75.92s)
```

Audio läuft mit 24x Geschwindigkeit, Video mit 3.5x. AV-Drift: 449 Sekunden.

### Root Cause — falsche Annahme über `-re`

Das `-re`-Flag war mit der Begründung entfernt worden: "Die Datei ist vollständig,
kein Pacing nötig." Diese Annahme ist falsch.

**Was `-re` wirklich steuert:** Die Abspielgeschwindigkeit der Eingabe, nicht ob die
Datei noch wächst. Ohne `-re` liest ffmpeg die Datei so schnell die CPU es erlaubt.

- **Audio** (AAC → Opus Transcode): Sehr leichter Prozess → läuft mit 24x
- **Video** (H.264 → libx264 Re-Encode): CPU-intensiv → "nur" 3.5x

### Fix

`useRealtimeReading = true` wird jetzt immer für den Temp-File-Modus gesetzt.
Der Kommentar im Code stellt klar: "Steuert Abspielgeschwindigkeit, NICHT ob die Datei wächst."

- `src/stream/ffmpeg.ts`, Zeile ~814: `const useRealtimeReading = true;`

---

## 3. Bug: 590ms AV-Drift im Full-Download-Modus (REQ-043-B)

### Symptom

Audio ist konstant ~590ms vor dem Video, obwohl beide ffmpeg-Prozesse gleichzeitig über
ein SYNC-Gate gestartet werden.

### Root Cause

libx264-Initialisierung dauert ca. 600ms. Während dieser Zeit sendet der Audio-ffmpeg-Prozess
(leichterer AAC→Opus-Transcode) bereits RTP-Pakete. Der Video-Prozess produziert in dieser
Zeit noch keine RTP-Ausgabe.

**Wichtig:** Audio und Video starten wirklich gleichzeitig (SYNC-Barrier bestätigt durch Logs).
Der Drift entsteht nicht beim Start, sondern nach dem Start durch unterschiedliche
Codec-Initialisierungszeiten.

**Ablauf:**
```
t=0ms:      Beide ffmpeg-Prozesse spawnen gleichzeitig (SYNC-Gate)
t=0–600ms:  Audio produziert bereits RTP (AAC→Opus ist trivial)
t=0–600ms:  Video initialisiert libx264 (noch kein RTP-Output)
t=600ms:    Video beginnt RTP zu senden
Ergebnis:   Audio ist dauerhaft ~600ms ahead
```

### Fix

`getAdaptiveAudioDelayMs` in `src/index.ts` gibt für den Full-Download-Modus jetzt
600ms zurück (vorher: 0ms). Audio wird via `adelay=600|600` ffmpeg-Filter um 600ms verzögert.

**Konstanten in `src/index.ts`:**
```typescript
const DEFAULT_FULL_DOWNLOAD_AUDIO_DELAY_MS = 600;
// REQ-043-B: libx264 re-encode initialization takes ~600ms. During that time, the audio
// ffmpeg (which only does AAC→Opus transcode, much lighter) gets ahead by ~600ms.
```

Die Funktion `getAdaptiveAudioDelayMs(channelId, fullDownloadMode)` wählt je nach Modus:
- Full-Download-Modus: immer `DEFAULT_FULL_DOWNLOAD_AUDIO_DELAY_MS` (600ms)
- Progressive Modus: adaptiver Wert aus `adaptiveAudioDelayMsByChannel` (default: 650ms)

**Implementierungs-Pfad:**
1. `getAdaptiveAudioDelayMs()` → `src/index.ts`, Zeile ~264
2. Ergebnis als `syncDelayMs` an `spawnFfmpeg` übergeben → `src/index.ts`, Zeile ~653
3. `buildAudioStreamArgs` injiziert `adelay` Filter → `src/stream/ffmpeg.ts`, Zeilen ~398–401

---

## 4. Bug: `-vsync` Deprecation-Warning (REQ-043)

### Symptom

ffmpeg 7.0.2 gibt bei jedem Start eine Warnung aus:
```
-vsync is deprecated. Use -fps_mode
```

### Fix

| Alt | Neu |
|-----|-----|
| `-vsync 0` | `-fps_mode passthrough` |
| `-vsync cfr` | `-fps_mode cfr` |

Full-Download-Modus nutzt jetzt `-fps_mode passthrough` (Timestamps 1:1 durchreichen,
kein Drop/Dup), Streaming-Modus nutzt `-fps_mode cfr` (konstante Framerate für stabile
Timestamps).

- `src/stream/ffmpeg.ts`, Zeilen ~329–337: `buildVideoStreamArgs` AV-Sync-Flags

---

## 5. Architektur-Erkenntnis: Warum gleichzeitiger Start trotzdem Drift erzeugt

Das SYNC-Gate funktioniert korrekt. Beide ffmpeg-Prozesse spawnen bei exakt demselben
Zeitpunkt. Der Drift ist kein Synchronisationsfehler, sondern ein Codec-Eigenschaft.

```
Irrtum: "Drift => SYNC-Gate funktioniert nicht"
Wahrheit: Drift entsteht NACH dem gleichzeitigen Start durch Codec-Initialisierungszeit
```

Die Lösung ist kein späterer Audio-Start, sondern ein vorgelagerter Audio-Delay-Filter,
der Audio künstlich um die erwartete Initialisierungszeit des Video-Codecs verzögert.

Dieses Muster (Codec-spezifischer Startup-Offset) ist plattformabhängig und kann sich
bei Hardware-Encodern (nvenc, vaapi) oder anderen libx264-Versionen unterscheiden.
Der adaptive Mechanismus (`adaptiveAudioDelayMsByChannel`) erlaubt Laufzeit-Anpassung
auf Basis gemessener AV-Drift-Werte.

---

## 6. Neue E2E-Test-Pipeline

### Datei

`tests/docker/pipeline-e2e.test.ts` — referenziert REQ-044

### Ausführung

```bash
docker compose -f tests/docker/docker-compose.yml run --rm pipeline-e2e
```

### Was getestet wird

- Streaming-Modus (Progressive Mode) gegen ein echtes YouTube-Video
- Full-Download-Modus gegen ein echtes YouTube-Video
- Assertion: Mindestens 85% der erwarteten Video-Dauer wurden gestreamt

### Hilfs-Infrastruktur

- `ensureBinSymlinks()`: Erstellt Symlinks im `src/stream/bin/`-Verzeichnis auf die
  im Docker-Container verfügbaren System-Binaries (ffmpeg, yt-dlp)
- Test-URL: `https://youtu.be/HrNzO3V7Ob0`

---

## 7. Zusammenfassung der geänderten Dateien

| Datei | Änderung | REQ |
|-------|----------|-----|
| `src/stream/ffmpeg.ts` | Progressive Mode wartet jetzt auf yt-dlp-Abschluss (max. 120s) vor ffmpeg-Start | REQ-044-B |
| `src/stream/ffmpeg.ts` | `useRealtimeReading = true` immer für Temp-File-Modus | REQ-043 |
| `src/stream/ffmpeg.ts` | `-vsync` → `-fps_mode` (passthrough / cfr) | REQ-043 |
| `src/stream/ffmpeg.ts` | `fullDownloadModePassed = true` wenn Temp-File-Modus | REQ-044-B |
| `src/index.ts` | `DEFAULT_FULL_DOWNLOAD_AUDIO_DELAY_MS = 600` | REQ-043-B |
| `src/index.ts` | `getAdaptiveAudioDelayMs()` gibt 600ms für Full-Download zurück | REQ-043-B |
| `tests/docker/pipeline-e2e.test.ts` | Neue E2E-Test-Pipeline für Streaming- und Full-Download-Modus | REQ-044 |

---

## 8. Offene Punkte

- Langzeit-Beobachtung: Ist 600ms die richtige Konstante für alle Server-Konfigurationen?
  Bei Hardware-Encodern könnte der Wert abweichen.
- Der adaptive `adaptiveAudioDelayMsByChannel`-Mechanismus für Progressive Mode
  sollte in einer eigenen Session validiert werden.
- E2E-Tests laufen nur in Docker — CI-Integration steht noch aus.
