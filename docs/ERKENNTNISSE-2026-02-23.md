# Erkenntnisse — 23. Februar 2026

## Session-Zusammenfassung

Ziel der heutigen Session war es, das fertig implementierte Plugin `sharkord-vid-with-friends`
erstmals in einem echten Sharkord-Server (Docker) zu testen und die dabei auftretenden
Laufzeitfehler zu beheben.

---

## 1. Docker-Umgebung für Sharkord

### Sharkord Docker-Image

- **Image:** `sharkord/sharkord:v0.0.6` (216 MB, amd64+arm64)
- **Entrypoint:** `/usr/local/bin/docker-entrypoint.sh` → startet `/sharkord`
- **Working Directory:** `/home/bun/app`
- **Runtime im Container:** Bun v1.3.5
- **Binary:** `/sharkord` ist eine 120 MB große kompilierte Bun-Anwendung

### Wichtige Pfade im Container

| Pfad | Beschreibung |
|------|--------------|
| `/root/.config/sharkord/plugins/` | Plugin-Verzeichnis — hier wird das Plugin gemountet |
| `/root/.config/sharkord/db.sqlite` | SQLite-Datenbank (Settings, Plugin-States, etc.) |
| `/root/.config/sharkord/mediasoup/mediasoup-worker` | Mediasoup Worker Binary |
| `/root/.config/sharkord/interface/0.0.6/` | Web-Frontend (React SPA) |
| `/root/.config/sharkord/uploads/` | Datei-Uploads |
| `/root/.config/sharkord/logs/` | Log-Dateien |

### Erkannte Environment-Variablen

| Variable | Beschreibung |
|----------|--------------|
| `SHARKORD_PORT` | HTTP-Port (Default: 3000) |
| `SHARKORD_DEBUG` | Debug-Modus aktivieren (`true`/`false`) |
| `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS` | Announced IP für WebRTC (wichtig für NAT) |
| `SHARKORD_WEBRTC_PORT` | WebRTC UDP Port (Default: 40000) |
| `SHARKORD_MEDIASOUP_BIN_NAME` | Name des Mediasoup Worker Binary |
| `SHARKORD_AUTOUPDATE` | Auto-Update aktivieren/deaktivieren |
| `SHARKORD_ENV` | Umgebung (production/development) |
| `PLUGINS_PATH` | Überschreibt den Standard-Plugin-Pfad |

### Verfügbare Tools im Container

- **Vorhanden:** `tar`, `apt-get` (Debian-basiert)
- **NICHT vorhanden:** `wget`, `curl`, `sqlite3`, `strings`, `python3`
- **Konsequenz:** Der `init-binaries`-Service musste auf `alpine:latest` umgestellt werden,
  weil das Sharkord-Image keine Download-Tools hat.

### docker-compose.dev.yml Architektur

```
┌─────────────────┐     ┌──────────────────────────┐
│  init-binaries  │────▶│  Volume: plugin-binaries  │
│  (alpine:latest)│     │  /binaries/ffmpeg         │
│  Downloads:     │     │  /binaries/yt-dlp         │
│  - ffmpeg 80MB  │     └────────────┬─────────────┘
│  - yt-dlp 36MB  │                  │
└─────────────────┘                  │ mount :ro
                                     ▼
                        ┌──────────────────────────┐
                        │      sharkord-dev         │
                        │  sharkord/sharkord:v0.0.6 │
                        │                          │
                        │  Mounts:                 │
                        │  - dist/ → plugins/:ro   │
                        │  - binaries → bin/:ro    │
                        │  - sharkord-data volume  │
                        │                          │
                        │  Ports:                  │
                        │  - 3000 (HTTP)           │
                        │  - 40000-40100/udp (RTP) │
                        └──────────────────────────┘
```

---

## 2. Plugin-Aktivierung

### Erkenntnis: Plugin wird NICHT automatisch geladen

Sharkord erkennt Plugins im `plugins/`-Verzeichnis automatisch ("Found 1 plugins"),
aber sie müssen **manuell über die Web-UI aktiviert werden**.

- Beim ersten Start: http://localhost:3000 öffnen → Plugin-Sektion → Plugin aktivieren
- Nach Aktivierung: State wird in `db.sqlite` persistiert → Plugin lädt beim nächsten Start automatisch
- Relevante DB-Tabelle: `plugin_data` (mit `plugin_id` als Primary Key)
- Toggle-Route intern: `pluginManager.togglePlugin`

### Access Token

Beim allerersten Start zeigt Sharkord einen einmaligen Admin-Token in den Logs:
```
🚨🚨 I M P O R T A N T 🚨🚨
019c879b-d844-7000-aec9-b8f37564fbd9
```
Dieser muss gespeichert werden — er kann nicht wiederhergestellt werden!
(Wird im `sharkord-data` Volume persistiert, geht also bei `docker volume rm` verloren.)

---

## 3. Behobene Fehler

### Fehler 1: yt-dlp — `env: 'python3': No such file or directory` (Exit 127)

**Ursache:** Die Standard-`yt-dlp`-Datei von GitHub Releases ist ein Python-Script
(3 MB, beginnt mit `#!/usr/bin/env python3`). Im Sharkord-Container ist kein Python installiert.

**Lösung:** Stattdessen den **Standalone Linux Binary** herunterladen:
```
# Vorher (Python-Script, 3 MB):
https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp

# Nachher (Standalone Binary, 36 MB):
https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
```

**Geänderte Dateien:**
- `docker-compose.dev.yml` — Download-URL geändert
- `scripts/download-binaries.sh` — Download-URL geändert

### Fehler 2: yt-dlp — `WARNING: ffmpeg not found`

**Ursache:** yt-dlp sucht `ffmpeg` im System-PATH. Unser ffmpeg liegt aber in
`/root/.config/sharkord/plugins/sharkord-vid-with-friends/bin/ffmpeg` und ist nicht im PATH.

**Lösung:** Die Option `--ffmpeg-location <dir>` an alle yt-dlp-Aufrufe übergeben.

**Geänderte Dateien:**
- `src/stream/yt-dlp.ts`:
  - `YtDlpBuildOptions` um optionales `ffmpegLocation`-Feld erweitert
  - `buildYtDlpArgs()` gibt `--ffmpeg-location` mit, wenn gesetzt
  - `resolveVideo()` setzt `ffmpegLocation` auf das `bin/`-Verzeichnis
- `tests/unit/yt-dlp.test.ts` — 2 neue Tests für `ffmpegLocation`

### Fehler 3: play-Command setzt Flag, startet aber keinen Stream

**Ursache:** Der `/watch`-Command rief nur `syncController.setPlaying(channelId, true)` auf —
das setzt nur ein Boolean-Flag, ruft aber nie `startStream()` auf.

**Lösung:** Neue `syncController.play(channelId)` Methode, die:
1. Das aktuelle Queue-Item holt (`getCurrent`)
2. `isPlaying = true` setzt
3. `startStream(channelId, item)` aufruft

**Geänderte Dateien:**
- `src/sync/sync-controller.ts` — neue `play()` Methode
- `src/commands/play.ts`:
  - Ruft jetzt `await syncController.play(channelId)` statt `setPlaying(true)`
  - Bessere try/catch-Fehlerbehandlung mit Logging
  - Stream-URL-Validierung (`if (!resolved.streamUrl)`)
- `tests/unit/sync-controller.test.ts` — 2 neue Tests für `play()`

### Fehler 4: HLS-Zwischenschritt — `Error opening input: No such file or directory`

**Ursache:** Die Pipeline hatte 3 ffmpeg-Prozesse:
1. URL → HLS-Segmente auf Disk (`/tmp/vwf-hls-3/stream.m3u8`)
2. HLS → Video RTP
3. HLS → Audio RTP

Probleme:
- Das Verzeichnis `/tmp/vwf-hls-3/` wurde nie angelegt (`mkdir` fehlte)
- Die 2-Sekunden-Wartezeit reichte nicht aus, bis HLS-Segmente geschrieben waren
- Grundsätzlich unnötige Komplexität — ffmpeg kann direkt von HTTP-URLs lesen

**Lösung:** HLS-Zwischenschritt komplett entfernt. Direkte Pipeline:
```
URL → ffmpeg (Video RTP)  ──→ Mediasoup Video Producer
URL → ffmpeg (Audio RTP)  ──→ Mediasoup Audio Producer
```

Nur noch 2 ffmpeg-Prozesse statt 3. Kein Temp-Verzeichnis mehr nötig.

**Geänderte Dateien:**
- `src/stream/ffmpeg.ts`:
  - `HlsOptions` Type entfernt
  - `buildHlsArgs()` Funktion entfernt
  - `VideoStreamOptions.inputPath` → `VideoStreamOptions.sourceUrl`
  - `AudioStreamOptions.inputPath` → `AudioStreamOptions.sourceUrl`
  - Video/Audio-Args enthalten jetzt `-reconnect` Flags für Netzwerk-Streams
  - Audio volume-Logik vereinfacht (kein doppeltes Normalisieren mehr)
- `src/index.ts`:
  - `buildHlsArgs` Import entfernt
  - `os` Import entfernt (kein tmpdir mehr nötig)
  - `startStream()` vereinfacht: kein HLS-Prozess, kein mkdir, keine 2s-Wartezeit
  - Von 12 Schritten auf 9 reduziert
- `src/stream/stream-manager.ts`:
  - `hlsProcess` aus `ChannelStreamResources` entfernt
  - `cleanup()` killt nur noch video+audio Prozesse
- `src/utils/constants.ts`:
  - `HLS_SEGMENT_DURATION` und `HLS_LIST_SIZE` entfernt
- `tests/unit/ffmpeg.test.ts`:
  - HLS-Tests entfernt
  - Video/Audio-Tests auf `sourceUrl` statt `inputPath` umgestellt
  - Reconnect-Tests hinzugefügt
- `tests/unit/stream-manager.test.ts` — `hlsProcess: null` entfernt
- `tests/docker/e2e-smoke.test.ts` — HLS-Referenzen entfernt

---

## 4. Aktueller Stand nach Bugfixes

### Test-Ergebnisse
```
108 pass, 0 fail, 256 expect() calls
Ran 108 tests across 8 files [95ms]
```

### Build
```
Bundled 18 modules in 18ms
index.js  42.57 KB  (entry point)
```

### Plugin-Logs nach Live-Test
```
[watch] Resolved: "Video Title" (1264s)
Created external stream 'Video Title' (key: vid-with-friends, id: 1) with tracks: audio=true, video=true
[stream:3] Streaming: Video Title
```

Der Bot kommt kurz in den Channel, verschwindet aber wieder, weil ffmpeg
sofort beendet wird. Die Stream-URL von yt-dlp scheint zu funktionieren
(Resolve erfolgreich), aber ffmpeg kann sie nicht abspielen.

### Offene Punkte für nächste Session

1. **ffmpeg streamt nicht stabil** — Bot erscheint kurz und verschwindet.
   Mögliche Ursachen:
   - Stream-URL ist ein DASH/HLS-Manifest statt einer direkten URL
   - ffmpeg braucht zusätzliche Flags für YouTube-URLs (z.B. User-Agent, Referer)
   - YouTube-URL ist zeitlich begrenzt und läuft ab
   - Eventuell muss yt-dlp eine direkte Playback-URL (`-f best -g`) liefern statt einer Manifest-URL

2. **Lösungsansätze für nächste Session:**
   - ffmpeg-Logs genauer analysieren (was passiert nach dem Spawn?)
   - Alternative: yt-dlp mit `-g` Flag direkt die Stream-URL extrahieren
   - Alternative: yt-dlp als Pipe (`yt-dlp -o - URL | ffmpeg -i pipe:0 ...`) statt URL
   - Prüfen ob `resolved.streamUrl` eine valide direkte URL ist

3. **Weitere offene Punkte:**
   - WebRTC-Konnektivität testen (127.0.0.1 als announcedAddress funktioniert nur lokal)
   - Pause/Resume implementieren (aktuell nur Flag, kein SIGSTOP/SIGCONT)
   - UI-Komponenten live testen

---

## 5. Commit-Historie (heute)

| Hash | Message | Dateien |
|------|---------|---------|
| `666c579` | `fix(REQ-001): fix yt-dlp binary, ffmpeg-location, and stream start pipeline` | 7 files, +187/-11 |
| (staged) | `refactor(REQ-002): remove HLS intermediate step, direct URL-to-RTP streaming` | 7 files |

---

## 6. Gelernte Patterns für Sharkord-Plugin-Entwicklung

### Plugin-Lifecycle
```
onLoad(ctx) → ctx.commands.register() → ctx.settings.register() → ctx.events.on()
                                                ↓
                                        Plugin aktiviert
                                                ↓
                        User führt /watch aus → resolveVideo() → startStream()
                                                ↓
                        streamManager.createTransports() → createProducers()
                                                ↓
                        ctx.actions.voice.createStream() → Bot im Channel
                                                ↓
                        spawnFfmpeg(videoArgs) + spawnFfmpeg(audioArgs)
                                                ↓
                        monitorProcess() → onVideoEnded() → auto-advance
```

### Binary-Management in Docker
- Binaries (ffmpeg, yt-dlp) in ein separates Docker Volume
- `init-binaries`-Service mit Alpine (hat wget) für Downloads
- Volume wird als `bin/` ins Plugin-Verzeichnis gemountet
- `--ffmpeg-location` an yt-dlp übergeben, da Binaries nicht im PATH

### Testing-Workflow
```
Code ändern → bun test → bun run build → docker restart sharkord-dev → Logs prüfen
```
