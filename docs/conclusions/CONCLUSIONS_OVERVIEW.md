# Übergreifende Erkenntnisse — sharkord-vid-with-friends

> Konsolidiert aus 20 Session-Conclusions (23. Feb – 29. März 2026).
> Letztes Update: 31. März 2026

---

## Inhaltsverzeichnis

1. [Docker & Sharkord-Umgebung](#1-docker--sharkord-umgebung)
2. [Streaming-Pipeline Evolution](#2-streaming-pipeline-evolution)
3. [ffmpeg Probleme & Lösungen](#3-ffmpeg-probleme--lösungen)
4. [yt-dlp Probleme & Lösungen](#4-yt-dlp-probleme--lösungen)
5. [Audio/Video Synchronisation](#5-audiovideo-synchronisation)
6. [WebRTC & Mediasoup](#6-webrtc--mediasoup)
7. [Command-System & SDK-Kompatibilität](#7-command-system--sdk-kompatibilität)
8. [Settings & Runtime-Verhalten](#8-settings--runtime-verhalten)
9. [Debug- & Diagnosesystem](#9-debug--diagnosesystem)
10. [Test-Infrastruktur](#10-test-infrastruktur)
11. [Plattform-Migrationen](#11-plattform-migrationen)
12. [Architektur-Entscheidungen & Lessons Learned](#12-architektur-entscheidungen--lessons-learned)
13. [Requirements-Übersicht](#13-requirements-übersicht)

---

## 1. Docker & Sharkord-Umgebung

### Container-Architektur

- **Image:** `sharkord/sharkord:v0.0.16` (aktuell), historisch v0.0.6 → v0.0.7 → v0.0.15 → v0.0.16
- **Runtime im Container:** Bun
- **Container-User:** `bun` (seit v0.0.15; vorher `root`)
- **Konfig-Verzeichnis:** `/home/bun/.config/sharkord/` (seit v0.0.15; vorher `/root/.config/sharkord/`)

### docker-compose.dev.yml Architektur

```
┌─────────────────┐     ┌──────────────────────────┐
│  init-binaries  │────▶│  Volume: plugin-binaries  │
│  (alpine:latest)│     │  /binaries/ffmpeg         │
│  Downloads:     │     │  /binaries/yt-dlp         │
│  - ffmpeg ~80MB │     └────────────┬─────────────┘
│  - yt-dlp ~36MB│                   │ mount
└─────────────────┘                  ▼
                        ┌──────────────────────────┐
                        │      sharkord-dev         │
                        │  Mounts:                 │
                        │  - dist/ → plugins/      │
                        │  - binaries → bin/       │
                        │  - sharkord-data volume  │
                        │  - debug-cache/          │
                        │  Ports:                  │
                        │  - 3000 (HTTP)           │
                        │  - 40000-40100/udp (RTP) │
                        │  Env:                    │
                        │  - YT_DLP_PATH (explizit)│
                        │  - FFMPEG_PATH (explizit)│
                        └──────────────────────────┘
```

### Wichtige Environment-Variablen

| Variable | Beschreibung |
|----------|--------------|
| `SHARKORD_PORT` | HTTP-Port (Default: 3000) |
| `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS` | Announced IP für WebRTC — muss Host-LAN-IP sein |
| `SHARKORD_WEBRTC_PORT` | WebRTC UDP Port (Default: 40000) |
| `YT_DLP_PATH` | Expliziter Pfad zur yt-dlp Binary (verhindert ENOENT) |
| `FFMPEG_PATH` | Expliziter Pfad zur ffmpeg Binary |
| `SHARKORD_DATA_PATH` | Expliziter Daten-Pfad |

### Plugin-Aktivierung

- Plugins werden automatisch erkannt, müssen aber **manuell über die Web-UI aktiviert** werden.
- Beim allerersten Start zeigt Sharkord einen einmaligen Admin-Token in den Logs.
- Token wird in `sharkord-data` Volume persistiert — bei `docker volume rm` verloren.
- **Wichtig:** Bei `docker compose down --volumes` wird ein NEUER Token generiert!

### Dev-Stack Commands

```bash
bun run dev:stack        # build + docker up + logs + Token
bun run dev:reload       # build + docker restart + logs + Token
bun run dev:stack:fresh  # build + down --volumes + up + logs + Token
```

### Volume-Mounts: Kein `:ro` auf Plugin-Verzeichnis

Sharkord führt beim Container-Start `chown` auf das Plugin-Verzeichnis aus. Read-only-Mounts (`:ro`) brechen den Container-Start.

---

## 2. Streaming-Pipeline Evolution

### Finale Pipeline (aktueller Stand)

```
1. User: /vid-watch <youtube_url>
2. yt-dlp --dump-json: Resolve Metadata + Formate + YouTube-URL
3. Parse: Beste Video/Audio Format-IDs + Stream-URLs
4. QueueItem: Speichere streamUrl, audioUrl, youtubeUrl, formatIds
5. Mediasoup: Create PlainTransports (video port + audio port)
6. Video-Track:
   yt-dlp -f <formatId> -o <temp-file> <youtube_url>
   → ffmpeg -re -i <temp-file> -c:v libx264 ... -f rtp rtp://127.0.0.1:PORT
7. Audio-Track (analog):
   yt-dlp -f <formatId> -o <temp-file> <youtube_url>
   → ffmpeg -re -i <temp-file> -c:a libopus ... -f rtp rtp://127.0.0.1:PORT
8. Mediasoup: Producers empfangen RTP → WebRTC zu Clients
```

### Pipeline-Evolution (chronologisch)

| Phase | Ansatz | Problem | Lösung |
|-------|--------|---------|--------|
| 1 (Feb 23) | ffmpeg direkt mit YouTube-URL | URL zu lang → Segfault (exit 139) | — |
| 2 (Feb 24) | yt-dlp stdout pipe → ffmpeg stdin | Funktioniert, aber Sync-Probleme | — |
| 3 (Feb 26) | HLS statt RTP (wegen v0.0.7 Consumer-Bug) | CPU-Crash bei VP8 Re-Encoding | — |
| 4 (Feb 28) | Zurück zu RTP mit Temp-File-Ansatz | Premature EOF bei progressivem Download | — |
| 5 (Mrz 4+) | Temp-File mit konditionaler `-re` Flag | Stabil, AV-Sync per adelay | **Aktuell** |

### Zwei Download-Modi

| Modus | `fullDownloadMode` | Verhalten |
|-------|-------------------|-----------|
| **Full Download** | `true` | Warte auf vollständigen yt-dlp-Download, dann ffmpeg-Start |
| **Progressive** | `false` | Buffer bis 10MB, warte auf yt-dlp-Abschluss (max. 120s), dann ffmpeg |

**Wichtig:** In beiden Modi wird `-re` (Realtime Reading) gesetzt. `-re` steuert die **Abspielgeschwindigkeit**, nicht ob die Datei noch wächst. Ohne `-re` liest ffmpeg so schnell wie die CPU erlaubt (Audio 24x, Video 3.5x).

---

## 3. ffmpeg Probleme & Lösungen

### Exit Code 139 (SIGSEGV) — Buffer Overflow

- **Ursache:** YouTube-URLs sind 3000+ Zeichen lang. Statisch kompiliertes ffmpeg hat ~2048 Byte Command-Line-Buffer.
- **Lösung:** Nie URLs als ffmpeg-Argument übergeben. Stattdessen Temp-File-Ansatz.

### Premature EOF bei progressivem Download (REQ-044)

- **Ursache:** ffmpeg startete nach 10MB Buffer, traf EOF der noch wachsenden Temp-Datei.
- **Lösung:** Progressive Mode wartet jetzt auf vollständigen yt-dlp-Abschluss (max. 120s) vor ffmpeg-Start.

### Video stoppt nach ~40 Sekunden (REQ-038)

- **Ursache:** `-re` + kompletter Download = ffmpeg interpretiert MP4-Duration-Header als Ziel.
- **Lösung:** Nicht relevant im aktuellen Code, da `-re` immer gesetzt und auf Temp-File-Abschluss gewartet wird.

### Audio-Pakete zu groß für RTP

- **Fehler:** `Packet size 1276 too large for max RTP payload size 1188`
- **Lösung:** `-frame_duration 20 -vbr off` in Opus-Encoder-Konfiguration.

### `-vsync` Deprecation

- **ffmpeg 7.0.2:** `-vsync` ist deprecated.
- **Fix:** `-vsync 0` → `-fps_mode passthrough`, `-vsync cfr` → `-fps_mode cfr`

### Finale ffmpeg Command-Struktur

**Video:**
```bash
ffmpeg -hide_banner -loglevel info -re \
  -i <temp-file> -an \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 3000k -maxrate 3000k -bufsize 6000k \
  -pix_fmt yuv420p -fps_mode passthrough \
  -g 25 -keyint_min 25 \
  -payload_type 96 -ssrc <random> \
  -f rtp rtp://127.0.0.1:<PORT>?pkt_size=1200
```

**Audio:**
```bash
ffmpeg -hide_banner -loglevel info -re \
  -i <temp-file> -vn \
  -af "adelay=600|600,volume=0.75" \
  -c:a libopus -ar 48000 -ac 2 -b:a 128k \
  -frame_duration 20 -vbr off -application audio \
  -payload_type 111 -ssrc <random> \
  -f rtp rtp://127.0.0.1:<PORT>?pkt_size=1200
```

---

## 4. yt-dlp Probleme & Lösungen

### Python3 nicht verfügbar (Feb 23)

- **Ursache:** Standard-yt-dlp von GitHub ist ein Python-Script.
- **Lösung:** Standalone Linux Binary herunterladen (`yt-dlp_linux` statt `yt-dlp`).

### ffmpeg nicht im PATH

- **Lösung:** `--ffmpeg-location <dir>` an yt-dlp übergeben.

### JavaScript Runtime Warning

- **Lösung:** `--js-runtimes bun` an alle yt-dlp-Aufrufe.

### YouTube SABR-Streaming (REQ-042, REQ-045)

YouTube erzwingt für Server-IPs "Server-Adaptive Bitrate (SABR)"-Streaming. Alle DASH/MP4-Formate sind dann nicht downloadbar.

**Erkennungsmerkmale im Log:**
```
Some web_safari client https formats have been skipped as they are missing a URL.
YouTube is forcing SABR streaming
```

**3-stufige Retry-Kette:**

| Versuch | Beschreibung | Format-Selektor | URL |
|---------|-------------|-----------------|-----|
| 1 | Locked formatId | `-f <id>` | YouTube-URL |
| 2 | Generischer Selektor | `bv[vcodec^=avc1]/bv[vcodec^=vp09]/bv[vcodec^=av01]/bv` | YouTube-URL |
| 3 | CDN-URL-Fallback | Kein `-f` | googlevideo.com direkt |

### HLS-Sub-Format-IDs nicht portabel

Format-IDs mit `-N` Suffix (z.B. `301-0`) sind HLS-Playlist-Einträge, session-spezifisch und beim späteren Download nicht verfügbar. `isHlsSubFormatId()` filtert diese heraus.

### Format-Lock Regression (REQ-027-D)

Beim `/vid-watch` aufgelöste `formatId` kann beim Download nicht mehr verfügbar sein. Automatischer Retry ohne Format-Lock implementiert.

---

## 5. Audio/Video Synchronisation

### 590ms AV-Drift durch Codec-Initialisierung (REQ-043-B)

- **Ursache:** libx264-Initialisierung dauert ~600ms. Audio (AAC→Opus) startet sofort.
- **Lösung:** Audio-Delay via ffmpeg-Filter `adelay=600|600`.

```
t=0ms:      Beide ffmpeg-Prozesse spawnen gleichzeitig (SYNC-Gate)
t=0–600ms:  Audio sendet bereits RTP (trivial)
t=0–600ms:  Video initialisiert libx264 (kein Output)
t=600ms:    Video beginnt RTP
→ Audio ist dauerhaft ~600ms ahead → kompensiert durch adelay
```

### Adaptiver Audio-Delay

- **Full-Download-Modus:** Fester Wert 600ms
- **Progressive Modus:** Startwert 650ms, wird aus realem A/V-Drift dynamisch angepasst
- Drift-Parser: Millisekunden-genaue `time=` Auswertung, Ausreißer-Filter (`|drift| > 2000ms`)

### Track-Sync (Start-Barrier)

- Beide Tracks laden parallel und melden `ready`.
- ffmpeg-Start erst nach gemeinsamem Sync-Signal.
- Endet ein Track vorzeitig → Gegen-Track kontrolliert beendet → Auto-Advance.

---

## 6. WebRTC & Mediasoup

### RTP-Routing: 0.0.0.0 vs. 127.0.0.1

- Man kann nicht **an** `0.0.0.0` senden — nur **von** ihr empfangen.
- **Fix:** `const rtpHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;`
- RTP (ffmpeg → Mediasoup) immer auf `127.0.0.1` (Container-intern).
- WebRTC (Mediasoup → Browser) über `announcedAddress` (Host-LAN-IP).

### Netzwerk-Architektur

```
┌──────────────────── Docker Container ────────────────────┐
│  ffmpeg ──RTP──→ Mediasoup Worker (listen: 0.0.0.0)     │
│                   127.0.0.1:PORT                         │
│                         │ WebRTC (announced: 192.168.x.x)│
└─────────────────────────┼────────────────────────────────┘
                          │ UDP 40000-40100
                          ▼
                    Browser Client
```

### H.264 Keyframe-Problem (historisch)

- Erster IDR ging verloren, weil Client-Consumer noch nicht fertig war.
- Kodiert wurde zwischenzeitlich VP8 (kein SPS/PPS nötig).
- **Aktuell:** H.264 mit 2s-Verzögerung nach `createStream()` vor ffmpeg-Start.

### Router RTP Capabilities (Referenz)

```
video/VP9   PT=100  video/VP8   PT=102
video/H264  PT=104  (42e01f)    PT=106  (640032)
video/AV1   PT=108  audio/opus  PT=110
```

---

## 7. Command-System & SDK-Kompatibilität

### Command-Namenskonvention

Alle Commands tragen `vid-`-Prefix: `vid-watch`, `vid-queue`, `vid-skip`, `vid-remove`, `vid-stop`, `vid-nowplaying`, `vid-pause`, `vid-resume`, `vid-volume`, `vid-debug-cache`, `vid-bugreport`.

### Response-Format (REQ-046)

- **v0.0.15:** Erforderte `{ response: string }` — plain String machte Command-Block unsichtbar.
- **v0.0.16:** Plaintext-Rückgabe direkt als String.

### Voice-Actions API-Kompatibilität (REQ-052)

`resolveVoiceActions(ctx)` abstrahiert unterschiedliche API-Formen:
- `ctx.actions.voice.*`
- `ctx.actions.*`
- `ctx.voice.*`
- Methoden-Aliasse: `getRouter`/`getVoiceRouter`, `createStream`/`addExternalStream`, etc.

### Fire-and-Forget für Stream-Start

`syncController.play(channelId)` wird nicht awaited (überschreitet Command-Response-Timeout). Fehler per `.catch()` abgefangen, fehlgeschlagenes Queue-Item wird entfernt.

### Single-Active-Guard (REQ-035)

Pro Channel nur ein aktives Video. Zweiter `/vid-watch` wird abgewiesen.

---

## 8. Settings & Runtime-Verhalten

### Registrierte Settings

| Setting | Typ | Default | Beschreibung |
|---------|-----|---------|-------------|
| `videoBitrate` | number | 3000 | Video-Bitrate in kbps |
| `audioBitrate` | number | 128 | Audio-Bitrate in kbps |
| `volume` | number | 75 | Lautstärke (0–100, normalisiert zu 0.0–1.0) |
| `debugMode` | boolean | false | Verbose Logging aktivieren |
| `fullDownloadMode` | boolean | false | Vor Wiedergabe vollständig laden |

### Stale-Settings-Problem (REQ-039)

`settings.get()` kann unmittelbar nach Save stale sein. Lösung: Event-Payload-Fallback mit In-Memory Overrides und robuster Boolean-Normalisierung (`true/false`, `1/0`, `on/off`, `yes/no`).

### Volume-Normalisierung (REQ-012)

Lautstärke wird als Prozentwert (z.B. `75`) gespeichert, muss vor Übergabe an ffmpeg zu Faktor (`0.75`) normalisiert werden. Ohne Normalisierung: massive Verstärkung/Clipping.

---

## 9. Debug- & Diagnosesystem

### Phase-Logging (REQ-027)

Strukturierte `[Phase]`-Einträge für diagnostische Filterung:

```
[Phase] RESOLVING   — yt-dlp --dump-json started
[Phase] RESOLVED    — title + duration
[Phase] FORMAT_SELECTED — formatIds + URLs
[Phase] DOWNLOADING — yt-dlp pipe started on temp file
[Phase] PIPING      — ffmpeg process spawned
[Phase] STREAMING   — ffmpeg producing RTP packets
```

### Debug-Cache (REQ-032, REQ-033)

- Docker-Volume: `./debug-cache/` → `/root/.config/sharkord/vid-with-friends-cache/`
- Bei aktivem Debug-Modus: yt-dlp-Download wird parallel in Cache-Datei geschrieben.
- `/vid-debug-cache` Command zeigt gecachte Dateien (nur bei `debugMode=true`).
- Temp-Files werden bei `debugMode=false` nach Nutzung gelöscht (REQ-037).

### Bug-Report Command (REQ-041)

Zwei Modi:
- **Mit `githubToken`:** Postet GitHub Issue via REST API (anonymisierte Logs).
- **Ohne Token:** Baut pre-filled GitHub Issue URL mit Short-Body.

Anonymisierung: User-IDs, IP-Adressen, CDN-URLs werden ersetzt.

---

## 10. Test-Infrastruktur

### Test-Suite

```bash
bun test                          # Alle Tests
bun test tests/unit/              # Unit-Tests (~170+)
bun test tests/integration/       # Integration-Tests (~20+)
```

### Pipeline-E2E (Docker)

```bash
docker compose -f tests/docker/docker-compose.yml run --rm pipeline-e2e
```

- Testet Progressive + Full-Download gegen echtes YouTube-Video.
- Gate: Läuft nur wenn `FFMPEG_PATH`/`YT_DLP_PATH` gesetzt (Docker-Umgebung).

### Binary-Pfadauflösung für Tests

Erweiterte Auflösung in `yt-dlp.ts` und `ffmpeg.ts`:
1. ENV-Override (`YT_DLP_PATH`, `FFMPEG_PATH`)
2. Plattform-Fallback (.exe / ohne .exe)
3. PATH-Suche via `Bun.which()`

---

## 11. Plattform-Migrationen

### v0.0.6 → v0.0.7 (Feb 26)

- Consumer-Filtering Bug: External Stream Producers als "own producer" erkannt → schwarzer Screen
- Workaround: Temporär HLS statt RTP, dann zurück zu RTP mit VP8

### v0.0.7 → v0.0.15 (Mrz 23)

- Container-User: `root` → `bun`
- Alle Pfade: `/root/.config/sharkord/` → `/home/bun/.config/sharkord/`
- Command-Response: plain String → `{ response: string }`
- `:ro`-Mounts auf Plugin-Verzeichnis entfernt
- `logo`-Feld in package.json entfernt (zod-Validierungsfehler)

### v0.0.15 → v0.0.16 (Mrz 29)

- SDK-Pakete auf `@sharkord/plugin-sdk@0.0.16` + `@sharkord/shared@0.0.16`
- Command-Response: zurück zu Plaintext (REQ-046)
- Voice-Actions API-Kompatibilitätslayer (REQ-052)
- Alle Agenten-Anleitungen auf v0.0.16 aktualisiert

---

## 12. Architektur-Entscheidungen & Lessons Learned

### Netzwerk & Container

- **Trennung intern/extern:** RTP immer `127.0.0.1`, WebRTC immer Host-LAN-IP.
- **Deterministische Binary-Pfade:** Explizite ENV-Variablen statt PATH-Suche im Container.
- **Keine `:ro`-Mounts** auf Plugin-Verzeichnisse (Sharkord braucht `chown`).

### Streaming

- **Piping ist die richtige Abstraktion** für große Datenmengen (stdin/stdout > Dateien).
- **`-re` steuert Abspielgeschwindigkeit**, nicht ob die Datei wächst.
- **Codec-spezifischer Startup-Offset** (libx264 ~600ms) muss via `adelay` kompensiert werden.
- **Format-Lock mit Fallback:** Locked formatId bevorzugen, bei Fehler generisch, dann CDN-URL.
- **SABR ist nicht lokal reproduzierbar** — nur auf Server-IPs aktiv.

### Debugging

- **Nicht annehmen, dass Exit-Code die Root-Cause ist** (SIGSEGV/139 kann viele Ursachen haben).
- **Phase-Logging** ermöglicht präzise Fehlerisolation (RESOLVING → DOWNLOADING → STREAMING).
- **Bypass-Testing:** Paralleles Cache-Schreiben isoliert Download- von Transport-Problemen.

### SDK-Kompatibilität

- **API-Abstraktionslayer** für Voice-Actions — toleriert unterschiedliche Runtime-Shapes.
- **Bei jeder SDK-Migration:** Dedizierte REQ, Migrationstest, Conclusions-Datei.
- **`logo`-Feld und ähnliche Metadaten** können silent Failures verursachen (keine Fehlermeldung, Commands unsichtbar).

### Version & Build

- Plugin-Version: `<basis>-<DDMMYY_HH_MM_SS>` (loader-kompatibel, kein `:`/`+`).
- Trace-Version: `<basis>:<DDMMYY_HH_MM_SS>` in `sharkordVersionTrace` (menschenlesbar).

---

## 13. Requirements-Übersicht

| REQ-ID | Thema | Status |
|--------|-------|--------|
| REQ-002 | Video-Streaming Pipeline (H264/RTP) | ✅ |
| REQ-003 | AV-Sync (Start-Barrier) | ✅ |
| REQ-008 | /skip Command | ✅ |
| REQ-009 | Auto-Advance bei Track-Ende | ✅ |
| REQ-010 | /stop Command | ✅ |
| REQ-012 | Volume-Normalisierung | ✅ |
| REQ-013 | Pause/Resume (SIGSTOP/SIGCONT) | ✅ |
| REQ-016 | Orphaned Temp-File Cleanup | ✅ |
| REQ-017 | UI-Registrierung | ⚠️ Runtime-abhängig |
| REQ-026 | Debug Mode Setting | ✅ |
| REQ-027 | Phase-Logging (A/B/C/D) | ✅ |
| REQ-028 | Stream-Phasenupdates via onPhaseChange | ✅ |
| REQ-029–031 | UI Controls (Pause, Stop, Skip Buttons) | ✅ (Runtime-abhängig) |
| REQ-032 | Debug-Cache (Download-Verifizierung) | ✅ |
| REQ-033 | /debug_cache Command | ✅ |
| REQ-034 | /resume Command | ✅ |
| REQ-035 | Single-Active-Guard pro Channel | ✅ |
| REQ-036 | fullDownloadMode Setting | ✅ |
| REQ-037 | Session-Cleanup (Temp-File Löschung) | ✅ |
| REQ-038 | Conditional -re Flag / Format-Lock | ✅ |
| REQ-039 | Runtime-Settings-Fallback (Stale Read) | ✅ |
| REQ-040 | Build-Version Format | ✅ |
| REQ-041 | /vid-bugreport Command | ✅ |
| REQ-042 | SABR-Format-Fallback (vp09/av01/bv) | ✅ |
| REQ-043 | AV-Drift Kompensation (600ms adelay) | ✅ |
| REQ-044 | Premature EOF Fix (Progressive Mode) | ✅ |
| REQ-045 | CDN-URL als dritter Fallback | ✅ |
| REQ-046 | Response als Plaintext | ✅ |
| REQ-051 | SDK 0.0.16 Migration | ✅ |
| REQ-052 | Voice-Actions API-Kompatibilitätslayer | ✅ |

---

## Quelldateien (Einzelne Session-Conclusions)

Die folgenden Einzeldateien wurden in diese Übersicht konsolidiert:

- `conclusions-2026-02-23.md`
- `conclusions-2026-02-24.md`
- `conclusions-2026-02-24-final.md`
- `conclusions-2026-02-24-final-session.md`
- `conclusions-2026-02-25.md`
- `conclusions-2026-02-26.md`
- `conclusions-2026-02-26-hls-phase1.md`
- `conclusions-2026-02-26-final-session.md`
- `conclusions-2026-02-27.md`
- `conclusions-2026-02-28.md`
- `conclusions-2026-03-03.md`
- `conclusions-2026-03-04.md`
- `conclusions-2026-03-04-phase-logging.md`
- `conclusions-2026-03-06.md`
- `conclusions-2026-03-07.md`
- `conclusions-2026-03-23-sharkord-v0015-migration.md`
- `conclusions-2026-03-25-sabr-format-fix.md`
- `conclusions-2026-03-26-av-sync-stream-stability.md`
- `conclusions-2026-03-26-cdn-url-fallback.md`
- `conclusions-2026-03-26-streaming-mode-analysis.md`
- `conclusions-2026-03-29-bugfix-command-and-pipeline-tests.md`
- `conclusions-2026-03-29-response-plaintext-fix-req046.md`
- `conclusions-2026-03-29-runtime-voice-actions-compat.md`
- `conclusions-2026-03-29-runtime-yt-dlp-enoent-hotfix.md`
- `conclusions-2026-03-29-sharkord-sdk-0016-migration.md`
