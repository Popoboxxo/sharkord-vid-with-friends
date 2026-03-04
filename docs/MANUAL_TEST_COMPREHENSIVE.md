# Comprehensive Test Protocol — sharkord-vid-with-friends

**Dauer:** ~45 Minuten  
**Ziel:** Vollständige Funktionsvalidierung aller Features  
**Voraussetzung:** Sharkord läuft, 2-3 Clients im Voice-Channel

---

## Vorbereitung (5 min)

### Setup
- [ ] Sharkord v0.0.6 aktiv: `http://localhost:3000`
- [ ] Plugin geladen und registriert
- [ ] Mindestens 2 Clients im Voice-Channel (ideal: 3)
- [ ] Debug-Modus in Settings: **ON** (für Log-Checking)
- [ ] Log-Fenster offen (Chrome DevTools oder Sharkord-Logs)

### Einstellungen vor Test
```
Application Settings:
  - Sync Mode: "Server-Streaming" (Standard)
  - Video Bitrate: 3000 kbps
  - Audio Bitrate: 128 kbps
  - Default Volume: 75
  - Full Download Mode: OFF (progressive)
  - Debug Mode: ON
```

**Log-Check:**
```
✓ [DEBUG] Plugin entrypoint loaded
✓ Registered 10 commands (watch, queue, skip, remove, stop, nowplaying, pause, resume, volume, debug_cache)
✓ Stream initialized
```

---

## Phase 1: Basic Commands (10 min)

### 1.1 /watch with YouTube URL

**Test:** `/watch https://www.youtube.com/watch?v=dQw4w9WgXcQ`

**Logs erwartet:**
```
[Phase] RESOLVING — yt-dlp --dump-json started
[Phase] RESOLVED — title: "Rick Astley...", duration: 212s
[Phase] FORMAT_SELECTED — videoFormatId: 18, audioFormatId: 251
[Phase] DOWNLOADING — yt-dlp pipe started on temp file
[Phase] PIPING — ffmpeg process spawned
[Phase] STREAMING — ffmpeg producing RTP packets
```

**Verifikation:**
- [ ] Video startet innerhalb 5 Sekunden
- [ ] Audio und Video sind synchron (keine Versatz > 100ms)
- [ ] Beide Clients sehen identisches Bild zur gleichen Zeit
- [ ] NowPlaying Badge zeigt: "🎬 Rick Astley - Never Gonna Give You Up"

**Messung:**
- Start-Time (clicked → video playing): ___ Sekunden
- Frame Sync (visueller Check): ___ ms Versatz

---

### 1.2 /watch with Search Query

**Test:** `/watch cat videos`

**Erwartet:**
- [ ] yt-dlp findet "ytsearch:" Ergebnis
- [ ] Video wird automatisch gestartet
- [ ] Titel ist ein Cat-Video (beliebig welches)

**Log-Check:**
```
[Phase] RESOLVING — ytsearch:cat videos
[Phase] RESOLVED — title: "..."
```

---

### 1.3 /queue Command

**Test:** `/queue` (während Video läuft)

**Erwartet:**
```
📹 Currently Playing:
  1. Rick Astley - Never Gonna Give You Up (3:32)

🎬 Upcoming Queue:
  (Empty)
```

- [ ] Zahlen stimmen mit tatsächlichem Video überein
- [ ] Formatierung korrekt

---

### 1.4 /nowplaying Command

**Test:** `/nowplaying`

**Erwartet:**
- [ ] Zeigt aktuelles Video
- [ ] Titel + Duration + Thumbnail Link

---

## Phase 2: Queue Management (10 min)

### 2.1 Mehrere Videos hinzufügen

**Test A:**
```
/watch https://www.youtube.com/watch?v=jNQXAC9IVRw
(während Video 1 läuft)
```

**Erwartet:**
- [ ] "Video zur Warteschlange hinzugefügt"
- [ ] `/queue` zeigt 2 Videos
- [ ] Video 1 läuft weiter, wird nicht unterbrochen

**Test B:**
```
/watch berlin
/watch london
/watch paris
```

**Erwartet:**
- [ ] Alle 3 Videos in Queue
- [ ] `/queue` zeigt 4 Videos insgesamt (1 aktuell + 3 Queue)

---

### 2.2 /skip Command

**Test A: Skip mit Warteschlange**
```
aktuell: Video A
queue: [Video B, Video C, Video D]

Execute: /skip
```

**Erwartet:**
- [ ] Video A stoppt sofort
- [ ] RTP-Stream beendet
- [ ] Video B startet automatisch nach 1-2 Sekunden
- [ ] Logs zeigen Auto-Advance Phase

**Logs erwartet:**
```
[Phase] STREAMING ← Video A
[VIDEO] Stream ended — total frames: 12850
[Phase] DOWNLOADING ← Video B starts
```

**Test B: Skip mit letztem Video**
```
aktuell: Video Z
queue: (leer)

Execute: /skip
```

**Erwartet:**
- [ ] Stream stoppt
- [ ] Meldung: "No more videos in queue" oder ähnlich
- [ ] NowPlaying Badge verschwindet

---

### 2.3 /remove Command

**Test A: Video aus Mitte entfernen**
```
queue: [1. Video A, 2. Video B, 3. Video C]

Execute: /remove 2
```

**Erwartet:**
- [ ] Video B entfernt
- [ ] A und C bleiben
- [ ] `/queue` bestätigt: nur [A, C]

**Test B: Aktuelles Video entfernen**
```
playing: Video A
queue: [Video B, Video C]

Execute: /remove 1
```

**Erwartet:**
- [ ] Video A stoppt
- [ ] Video B startet (Auto-Advance)
- [ ] `/queue` zeigt [B (now), C (queue)]

**Test C: Invalid Position**
```
Execute: /remove 999
```

**Erwartet:**
- [ ] Error: "Position out of range" oder ähnlich
- [ ] Queue unverändert

---

## Phase 3: Playback Control (10 min)

### 3.1 /pause und /resume

**Test A: Pause**
```
Video läuft...
Execute: /pause
```

**Erwartet:**
- [ ] Sound stoppt sofort
- [ ] Bild friert ein
- [ ] Badge zeigt Pause-Status (⏸)
- [ ] Alle Clients zeigen Pause
- [ ] Nur < 1 Sekunde Latenz

**Test B: Resume**
```
Video pausiert...
Execute: /pause  (oder /resume)
```

**Erwartet:**
- [ ] Sound läuft weiter
- [ ] Bild bewegt sich
- [ ] Badge zeigt Play-Status (▶)

**Test C: Pause während Auto-Advance deaktiviert**

```
Video läuft, Auto-Advance sollte bald kommen
Execute: /pause
(wait 3 seconds)
```

**Erwartet:**
- [ ] Auto-Advance passiert NICHT während Pause
- [ ] Nach `/resume`: Normal weiterlaufen

---

### 3.2 /volume Command

**Test A: Volume setzen**
```
Execute: /volume 50
(start new video)
```

**Erwartet:**
- [ ] Audio ist deutlich leiser als vorher
- [ ] Alle Clients hören identische Lautstärke
- [ ] Regler bei 50 in Settings

**Test B: Volume 0**
```
Execute: /volume 0
```

**Erwartet:**
- [ ] Kein Sound
- [ ] Video läuft weiter visual

**Test C: Volume 100**
```
Execute: /volume 100
```

**Erwartet:**
- [ ] Maximum Lautstärke
- [ ] Kein Clipping/Verzerrung

**Test D: Invalid Value**
```
Execute: /volume 150
Execute: /volume -10
```

**Erwartet:**
- [ ] Error: "Volume must be 0-100"
- [ ] Aktuelle Lautstärke unverändert

---

## Phase 4: Advanced Scenarios (10 min)

### 4.1 Full Download Mode Test

**Vorbereitung:**
1. Settings → Full Download Mode: **ON**
2. Settings → Speichern
3. Sharkord neu starten (optional, oder Plugin reload)

**Test: Längeres Video mit Full Download**
```
/watch https://www.youtube.com/watch?v=longevideo
(beobachte Logs)
```

**Logs erwartet:**
```
[Phase] DOWNLOADING — yt-dlp pipe started
Waiting for full download before starting ffmpeg...
(wait 10-20 Sekunden für Download)
Download complete, starting ffmpeg...
[FFmpeg config] -re flag: OFF (complete file)
[Phase] PIPING — ffmpeg process spawned
[Phase] STREAMING — ffmpeg producing RTP packets
```

**Verifikation:**
- [ ] Video startet nach kompletten Download
- [ ] Kein Early Termination (sollte volle Länge spielen)
- [ ] Audio/Video-Sync auch mit -re OFF korrekt

**Messung:**
- Download-Zeit: ___ Sekunden
- Total Start-Time (clicked → playing): ___ Sekunden

---

### 4.2 Progressive Mode Test

**Vorbereitung:**
1. Settings → Full Download Mode: **OFF**
2. Settings → Speichern

**Test: Schneller Start (Progressive)**
```
/watch https://www.youtube.com/watch?v=anothervideo
(beobachte Logs)
```

**Logs erwartet:**
```
[Phase] DOWNLOADING — yt-dlp pipe started
Waiting for initial buffer... (for 10 MB)
Temp file ready (10485 KB), starting ffmpeg...
[FFmpeg config] -re flag: ON (progressive)
[Phase] PIPING — ffmpeg process spawned
[Phase] STREAMING — ffmpeg producing RTP packets
```

**Verifikation:**
- [ ] Video startet nach ~2-3 Sekunden (10 MB Buffer)
- [ ] Während Download läuft weiter Streaming
- [ ] Kein Video-Stutter trotz laufendem Download
- [ ] Audio-Sync mit -re Flag ON

**Messung:**
- Buffer-Wait: ___ Sekunden
- Total Start-Time: ___ Sekunden
- **Vergleich:** Progressive sollte 3-5x schneller starten als Full Download

---

### 4.3 Multi-Client Sync Check

**Setup:** 3 Clients, 1 Video läuft

**Test A: Visuelle Synchronisation**
1. Stelle alle 3 Clients auf Frame-sichtbar, die auffällig ist (z.B. Schnitteffekt)
2. Beobachte: Sehen alle Clients diese Frame zur **exakt gleichen Zeit**?
3. Hinweis: Max 1 Bild (40ms @ 25fps, 33ms @ 30fps) Versatz akzeptabel

**Erwartet:**
- [ ] Alle Clients zeigen identisches Bild zeitgleich
- [ ] Kein erkennbarer Desync
- [ ] Audio läuft auf allen gleich

**Test B: Pause-Befehl auf allen**
```
Client A: /pause
(beobachte Client B und C)
```

**Erwartet:**
- [ ] Video auf B und C pausiert sofort
- [ ] Latenz < 1 Sekunde
- [ ] Kein Bild-Tearing

---

### 4.4 Auto-Advance Scenario

**Setup:**
```
Queue: [Video 1 (15 sec), Video 2 (10 sec), Video 3]
Debug Mode: ON
```

**Test A: Auto-Advance bei naturalem Ende**
1. Starte Video 1
2. Warte bis natürliches Ende (15 Sekunden)
3. Beobachte automatischen Übergang

**Erwartet:**
```
[VIDEO] Stream ended — total frames: 375 (15 sec @ 25fps)
[stream:X] Advancing to next video...
[Phase] DOWNLOADING — Video 2 starts
[Phase] STREAMING — Video 2 läuft
```

**Verifikation:**
- [ ] Übergang automatisch (kein Command nötig)
- [ ] < 2 Sekunden Pause zwischen Videos
- [ ] Auto-Advance kann nicht während Pause passieren

**Test B: Auto-Stop bei Queue-Ende**
1. Let Video 3 run naturally
2. Warte auf natürliches Ende

**Erwartet:**
- [ ] Stream stoppt (keine Fehler)
- [ ] "Queue exhausted" Log
- [ ] NowPlaying verschwindet

---

## Phase 5: Error Handling (5 min)

### 5.1 Invalid URL
```
Execute: /watch https://example.com/notavideo
```

**Erwartet:**
- [ ] Error: "Could not resolve video" oder ähnlich
- [ ] Logs zeigen yt-dlp exit code != 0
- [ ] Aktueller Stream läuft weiter unverändert

---

### 5.2 Duplicate Video Start

**Setup:** Video läuft bereits

```
Client A: /watch someurl
Client B: /watch anotherurl
```

**Erwartet (REQ-035):**
- [ ] Zweiter `/watch` wird abgewiesen
- [ ] Error: "A video is already playing in this channel"
- [ ] Aktuelles Video läuft weiter

---

### 5.3 Command outside Voice Channel

```
Client: /watch ... (nicht in Voice Channel)
```

**Erwartet:**
- [ ] Error: "You must be in a voice channel"
- [ ] Kein Stream started

---

### 5.4 /watch_stop Command

**Test:**
```
Queue: [Video A (playing), Video B, Video C]
Execute: /watch_stop
```

**Erwartet:**
- [ ] Stream A stoppt
- [ ] Queue wird geleert
- [ ] Logs zeigen cleanup
- [ ] `/queue` ist jetzt leer
- [ ] Keine weiteren Videos laufen

---

## Phase 6: Debug Mode & Logs (5 min)

### 6.1 Debug Mode ON

**Test:**
1. Settings → Debug Mode: ON
2. Settings → Speichern
3. Starte `/watch youtube_video`
4. Öffne Logs/Console

**Erwartet:**
```
[DEBUG:stream:X] Building video args...
[DEBUG:stream:X] FFmpeg cmd: /path/to/ffmpeg -hide_banner ...
[DEBUG:stream:X] [yt-dlp] Process started (PID: 12345)
[DEBUG:stream:X] [yt-dlp] wget: ... (verbose output)
```

- [ ] Verbose yt-dlp Output sichtbar
- [ ] Vollständige FFmpeg-Command geloggt
- [ ] Process PIDs sichtbar

---

### 6.2 /debug_cache Command

**Test:**
```
Execute: /debug_cache
(nachdem mehrere Videos abgespielt wurden)
```

**Erwartet:**
- [ ] Listet gecachte Dateien auf (wenn debug ON)
- [ ] Format: `video-<videoId>-<timestamp>.mp4` und `audio-<videoId>-<timestamp>.opus`
- [ ] Größen und Timestamps korrekt
- [ ] Wenn debug OFF: Error "Debug Mode disabled"

**Verifikation:**
- [ ] Dateien existieren im `./debug-cache/` Verzeichnis
- [ ] Größen > 0 KB

---

## Phase 7: UI Components (5 min)

### 7.1 NowPlayingBadge

**Beobachtung während Video läuft:**
- [ ] Badge zeigt 🎬 Icon
- [ ] Videotitel korrekt gekürzt (max 120 chars)
- [ ] Buttons sichtbar: ▶/⏸ (play/pause), ⏭ (skip, nur wenn Queue > 1), ⏹ (stop)

**Test Buttons:**
```
Klick ▶/⏸ Button
```
- [ ] Entspricht `/pause` Command
- [ ] Audio stoppt/läuft sofort

```
Klick ⏭ Button (wenn Queue > 1)
```
- [ ] Entspricht `/skip` Command
- [ ] Nächstes Video startet

```
Klick ⏹ Button
```
- [ ] Entspricht `/watch_stop` Command
- [ ] Stream stoppt

---

### 7.2 Preparation Progress Bar (REQ-028)

**Test (wenn implementiert):**
```
/watch <url>
(beobachte Progress-Bar)
```

**Erwartet:**
- [ ] Progress-Bar zeigt: "Video wird aufgelöst…" → "Download wird vorbereitet…" → "Stream wird gestartet…" → verschwindet
- [ ] Bar füllt sich von 0 → 100%
- [ ] Timing: ~3-5 Sekunden
- [ ] Phasen-Labels aktualisieren sich

---

## Summary Checklist

| Feature | Status | Notes |
|---------|--------|-------|
| /watch URL | ✓ | |
| /watch Query | ✓ | |
| /queue | ✓ | |
| /skip | ✓ | |
| /remove | ✓ | |
| /pause / /resume | ✓ | |
| /volume | ✓ | |
| /nowplaying | ✓ | |
| /watch_stop | ✓ | |
| Auto-Advance | ✓ | |
| Multi-Client Sync | ✓ | |
| Full Download Mode | ✓ | |
| Progressive Mode | ✓ | |
| Debug Mode | ✓ | |
| Error Handling | ✓ | |
| UI Components | ✓ | |

---

## Performance Metrics (Optional)

Trage Messwerte ein:

| Metric | Value | Expected |
|--------|-------|----------|
| Time to first frame (progressive) | ___ sec | < 5 sec |
| Time to first frame (full DL) | ___ sec | < 30 sec |
| Frame sync desync | ___ ms | < 100 ms |
| Skip latency | ___ ms | < 1000 ms |
| Pause latency | ___ ms | < 1000 ms |
| Multi-client sync | ___ ms | < 100 ms |

---

## Known Issues / Notes

```
Issue 1:
  Beschreibung: ...
  Workaround: ...
  REQ-ID: REQ-xxx

Issue 2:
  ...
```

---

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Tester | _______ | 4. März 2026 | PASS / FAIL |
| Reviewer | _______ | _______ | Review |

---

## Appendix: Debug Commands

### View Stream Status
```bash
curl http://localhost:3000/api/streams
```

### View Plugin Logs
```bash
docker logs sharkord-dev | grep "sharkord-vid-with-friends"
```

### Clean Debug Cache
```bash
rm -rf ./debug-cache/*.mp4 ./debug-cache/*.opus
```

### Check FFmpeg Binary
```bash
./bin/ffmpeg -version
```

### Check yt-dlp Binary
```bash
./bin/yt-dlp --version
```

---

**More Info:** Siehe [REQUIREMENTS.md](REQUIREMENTS.md) für RFC und [CODEBASE_OVERVIEW.md](CODEBASE_OVERVIEW.md) für Architektur.
