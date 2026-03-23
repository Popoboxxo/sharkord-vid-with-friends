# Erkenntnisse — 23. März 2026

## Session-Zusammenfassung

Migration auf Sharkord v0.0.15 und Fertigstellung des `/vid-bugreport` Commands (REQ-041).
Alle Commands wurden auf das neue Response-Format angepasst. Docker-Konfiguration auf neue
Container-Pfade migriert. Plugin-Version v0.1.0-alpha.5 released.

---

## 1. Sharkord v0.0.15 — Breaking Changes

### Command Response Format geändert

Alle `executes()`-Handler in `src/commands/*.ts` mussten angepasst werden.

**Alt:** `return "Playback stopped."`
**Neu:** `return { response: "Playback stopped." }`

Ein plain String führt in v0.0.15 dazu, dass der Command-Block im Chat unsichtbar ist.
Ursache: Das Frontend validiert die Response und rendert nur bei `{ response: string }`.

### Docker: Container läuft jetzt als `bun`-User

Sharkord v0.0.15 wechselte den Container-User von `root` auf `bun`.

- **Altes Konfig-Verzeichnis:** `/root/.config/sharkord`
- **Neues Konfig-Verzeichnis:** `/home/bun/.config/sharkord`

Alle Volume-Mounts in `docker-compose.dev.yml` mussten entsprechend angepasst werden.

### `:ro` Volume-Mounts brechen Container-Start

Sharkord v0.0.15 führt beim Container-Start `chown` auf das Plugin-Verzeichnis aus.
Read-only-Mounts (`:ro`) auf das Plugin-Verzeichnis verhindern diesen Schritt und crashen den Container.

**Lösung:** `:ro`-Flags auf allen Plugin-Verzeichnis-Mounts entfernt.

### Logo-Feld in package.json entfernt

Das `logo`-Feld in der `sharkord`-Config-Sektion wird vom Frontend mit `zod.url()` validiert.
Ein relativer Pfad `"logo.png"` besteht diese Validierung nicht — Sharkord macht alle Command-Blocks
für das Plugin unsichtbar (kein sichtbarer Fehler, Commands reagieren einfach nicht).

**Ursache identifiziert durch:** Commands waren registriert und onLoad lief durch, aber kein einziger
Command war im Chat sichtbar. Erst nach Entfernen des `logo`-Feldes wurden alle Commands sichtbar.

**Lösung:** `logo`-Feld vollständig aus `package.json` entfernt. Das `logo.png` bleibt im Build-Output.

### Wichtige Dateien
- `docker-compose.dev.yml`: aktualisierte Volume-Pfade und Image-Version
- `package.json`: `logo`-Feld entfernt aus `sharkord`-Config
- `src/commands/*.ts`: alle `executes()`-Handler auf `{ response: string }` umgestellt

---

## 2. Stream-Phasenupdates via onPhaseChange (REQ-028-B)

### Hintergrund

`spawnFfmpeg` in `src/stream/ffmpeg.ts` enthält einen `onPhaseChange`-Callback in `SpawnFfmpegOptions`. Dieser Callback ermöglicht es dem Aufrufer, Phasenübergänge des Streams zu verfolgen.

### Phasen

| Phase | Bedeutung |
|-------|-----------|
| `DOWNLOADING` | yt-dlp lädt herunter, ffmpeg noch nicht gestartet |
| `BUFFERING` | ffmpeg gestartet, RTP-Bytes noch nicht bestätigt |
| `STREAMING` | Producer-Score aktiv, RTP-Daten fließen |

### Verwendung in `src/index.ts`

`startStream` nutzt den `onPhaseChange`-Callback in `spawnFfmpeg`, um den Stream-Titel im Sharkord-UI zu aktualisieren. `monitorProducers` reagiert auf das erste Producer-Score-Event und löst `onStreamingDetected` aus, welches wiederum `streamHandle.update(...)` aufruft.

### Wichtige Referenzen

- Typ `SpawnFfmpegOptions.onPhaseChange`: `src/stream/ffmpeg.ts` L92
- Callback-Nutzung: `src/index.ts` in `startStream`

---

## 3. Debug-Cache-Dateien werden nach Download geschrieben (REQ-032)

Wenn `debugEnabled` aktiv ist, schreibt `spawnFfmpeg` nach dem yt-dlp-Download eine Kopie der heruntergeladenen Temp-Datei in das Debug-Cache-Verzeichnis. Der Dateiname enthält VideoId, StreamType und Zeitstempel (gebaut über `buildDebugCacheFileName`).

Der Cache-Pfad wird über `getDebugCacheDir()` bestimmt (interner Helper in `ffmpeg.ts`).

### Wichtige Referenzen

- `buildDebugCacheFileName`: `src/stream/ffmpeg.ts`
- `getDebugCacheDir`: `src/stream/ffmpeg.ts`
- `shouldCleanupDownloadedData`: `src/stream/ffmpeg.ts` — gibt `true` zurück wenn `debugEnabled=false`

---

## 4. Orphaned Temp-Files werden bei stop/cleanup/unload gelöscht (REQ-037, REQ-016)

`spawnFfmpeg` gibt `SpawnedProcess.tempFilePath` zurück. `StreamManager.cleanup()` löscht diese Datei beim Cleanup. Bei `cleanupAll()` (Plugin-Unload) werden alle registrierten Temp-Dateien gelöscht.

Im progressiven Modus kann die Temp-Datei noch existieren, wenn der Stream manuell gestoppt wird (ffmpeg wurde gekilled bevor yt-dlp fertig war). Ohne diese Cleanup-Logik würden temporäre Video/Audio-Dateien liegen bleiben.

### Wichtige Referenzen

- `SpawnedProcess.tempFilePath`: `src/stream/ffmpeg.ts`
- Cleanup-Logik: `src/stream/stream-manager.ts` `cleanup()` / `cleanupAll()`

---

## 5. Neuer Command: /vid-bugreport (REQ-041)

### Implementierung: `src/commands/bug-report.ts`

Zwei Betriebsmodi:

**Mit `githubToken` Setting:**
- Postet GitHub Issue vollständig via REST API
- Body enthält: Beschreibung, Plugin-Version, Plattform, Settings, letzte 100 Log-Zeilen (anonymisiert), letzte 30 Error-Log-Zeilen
- Labels: `bug`, `user-report`
- Gibt Issue-URL direkt im Chat zurück

**Ohne Token (tokenless Modus):**
- Baut pre-filled GitHub Issue URL mit Short-Body (Settings + letzte 20 Error-Zeilen)
- Gibt vollständigen Log-Block (100 Zeilen) zusätzlich im Chat aus zum manuellen Einfügen
- Kein OAuth, kein Login nötig

### Anonymisierung

Vor jeder Log-Ausgabe werden ersetzt:
- User-IDs (`userId: 42` → `userId: [USER]`)
- IP-Adressen (`192.168.x.x` → `[IP]`)
- CDN-URLs (nur Domain bleibt, Path wird zu `[...]`)

### Technische Entscheidung: Gist vs. pre-filled URL

Ein früherer Ansatz nutzte die GitHub Gist API als tokenless Fallback (anonyme Gists).
Dieser Ansatz wurde verworfen, da:
- Gist API erfordert inzwischen ebenfalls Token für zuverlässige anonyme Nutzung
- Pre-filled Issue URL ist einfacher und für den User direkter (Browser öffnet fertig ausgefülltes Issue-Formular)

Commit-Referenz: `075e09d fix(REQ-041): replace Gist with pre-filled GitHub issue URL for tokenless mode`

### Log-Pfade

Logs werden gelesen aus:
- `~/.config/sharkord/logs/combined.log` (letzte 100 Zeilen)
- `~/.config/sharkord/logs/error.log` (letzte 20–30 Zeilen)

Im Docker-Kontext entspricht `~` dem Home-Verzeichnis des `bun`-Users: `/home/bun`.

---

## 3. play.ts — Fire-and-Forget für syncController.play()

### Problem

`syncController.play()` wartet auf den vollständigen Stream-Start (yt-dlp resolve + ffmpeg spawn + Mediasoup transport setup). Das dauert mehrere Sekunden und überschreitet den Command-Response-Timeout von Sharkord.

### Lösung

`syncController.play(channelId)` wird **nicht mehr awaited**. Der Aufruf läuft im Hintergrund:

```typescript
syncController.play(channelId).catch((err: unknown) => {
  ctx.error(`[watch] Failed to start stream:`, errorMsg);
  queueManager.remove(channelId, 1);
});
```

Der Command antwortet sofort mit `{ response: "Starting: <title>" }`.
Fehler werden über `.catch()` abgefangen — bei Startfehler wird das gerade hinzugefügte Queue-Item wieder entfernt.

---

## 4. Plugin-Release v0.1.0-alpha.5

- Alle Commands mit `vid-`-Prefix registriert und sichtbar im Chat
- Command-Responses sichtbar (v0.0.15-Kompatibilität)
- Docker Dev-Stack läuft stabil gegen Sharkord v0.0.15

### Wichtige Referenzen

- Release-Commit: `c1aa0ce chore: prepare v0.1.0-alpha.5 release`
- Bug-Report Gist-Fix: `075e09d fix(REQ-041): replace Gist with pre-filled GitHub issue URL for tokenless mode`
- Bug-Report Gist-Basis: `a67d84a fix(REQ-041): create anonymous Gist as tokenless fallback for /vid-bugreport`
- Docker-Konfiguration: `docker-compose.dev.yml`
- Command-Implementierungen: `src/commands/`
