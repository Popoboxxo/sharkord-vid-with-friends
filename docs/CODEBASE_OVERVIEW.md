# Codebase Overview — sharkord-vid-with-friends

Stand: **03.03.2026**

Diese Übersicht ist eine **codegenaue Bestandsaufnahme** des aktuellen Implementierungsstands in `src/`.
Sie dokumentiert reale Funktionen, Signaturen, Laufzeitflüsse und REQ-Zuordnung (nicht nur Ziel-Architektur).

---

## 1) Scope & Architektur-Snapshot

- **Runtime:** Bun
- **Kern-Module:** Queue, Stream, Sync, Commands, UI
- **Entry Point:** `src/index.ts`
- **Streaming-Pfad (aktuell):** yt-dlp Download in Temp-Datei → ffmpeg RTP (Video+Audio getrennt) → Mediasoup Producer → Sharkord Stream
- **Alternative vorhanden:** HLS-Server + HLS-ffmpeg-Path (`src/stream/hls-server.ts`, `spawnFfmpegForHLS`)

---

## 2) Implementierungs-Matrix nach Datei

## `src/index.ts`

### Exportierte API

- `onLoad(ctx: PluginContext): Promise<void>`
  - Initialisiert `QueueManager`, `StreamManager`, `SyncController`
  - Registriert Settings (`videoBitrate`, `audioBitrate`, `defaultVolume`, `syncMode`, `debugMode`)
  - Registriert Commands: `watch`, `queue`, `skip`, `remove`, `watch_stop`, `nowplaying`, `pause`, `volume`, `debug_cache`
  - Registriert UI-Komponenten (`ctx.ui.registerComponents(...)` falls verfügbar)
  - Registriert Event-Handler für `voice:runtime_closed`
  - **REQ:** REQ-014, REQ-015, REQ-016, REQ-018, REQ-026

- `onUnload(ctx: PluginContext): void`
  - Ruft `streamManager.cleanupAll()` und `syncController.cleanupAll()` auf
  - **REQ:** REQ-016

- `components` (re-export)
  - `export { components } from "./ui/components"`
  - **REQ:** REQ-017

### Interne Funktionen

- `debugLog(ctx, prefix, ...messages): void`
  - Bedingtes Debug-Logging bei aktiviertem `debugMode`
  - Derzeit Hilfsfunktion, im File kaum aktiv genutzt.

- `startStream(ctx, channelId, item): Promise<void>`
  - Haupt-Orchestrierung:
    1. `streamManager.cleanup(channelId)`
    2. `ctx.actions.voice.getRouter(channelId)` + `getListenInfo()`
    3. `createPlainTransport(...)` für Audio+Video
    4. `transport.produce(...)` für Audio (Opus/PT111) + Video (H264/PT96)
    5. Settings lesen (`videoBitrate`, `audioBitrate`) + Volume aus `syncController` (0..100)
    6. Audio-Volume via `normalizeVolume(...)` auf 0..1 für ffmpeg normalisieren
    7. `spawnFfmpeg(...)` Video + Audio
    8. `ctx.actions.voice.createStream(...)`
    9. Ressourcen via `streamManager.setActive(...)`
    10. Producer-Monitoring + Health-Check
  - Fehlerpfad: Cleanup + `syncController.stop(channelId)` + throw Error
  - **REQ:** REQ-002, REQ-003, REQ-018, REQ-026, REQ-028-B

- `monitorProducers(ctx, channelId, videoProducer, audioProducer, streamHandle?, videoTitle?, onStreamingDetected?): void`
  - Hängt Observer auf Producer-`score`/`close`
  - Updatet Stream-Titel auf echten Videotitel beim ersten Score-Event
  - Fallback-Timer (8s) für Titelupdate
  - **REQ:** REQ-026, REQ-028-B

- `scheduleHealthCheck(ctx, channelId, videoProducer, audioProducer): void`
  - Verzögerter 5s-Check:
    - Producer-Stats (`getStats`) für RTP-Bytes/Packets
    - ffmpeg Prozessstatus aus `streamManager.getResources(channelId)`
  - **REQ:** REQ-026

- `monitorProcess(ctx, channelId, ffmpegProcess): void`
  - Wartet auf ffmpeg-Ende, cleanup + `syncController.onVideoEnded(...)`
  - **Hinweis:** Aktuell nicht zentral im aktiven Startpfad verwendet (Auto-Advance liegt primär im Audio-`onEnd` Callback von `spawnFfmpeg`).

- `monitorProcessForAutoAdvance(ctx, channelId, bunProcess): void`
  - HLS-Variante für Auto-Advance
  - Cleanup + `syncController.onVideoEnded(...)`

- `handleVoiceRuntimeClosed(ctx) => (...args) => void`
  - Event-Closure für `voice:runtime_closed`
  - Führt durch: stream cleanup + sync cleanup + queue clear
  - **REQ:** REQ-016

---

## `src/queue/types.ts`

- `QueueItem`
  - Felder: `id`, `query`, `title`, `youtubeUrl`, `streamUrl`, `audioUrl`, `duration`, `thumbnail`, `addedBy`, `addedAt`
- `QueueAddInput`
- `ResolvedVideo`
  - inkl. `videoFormatId`, `audioFormatId`
- `QueueState`
  - `current`, `upcoming`, `size`
- `QueueAdvanceCallback`

**REQ:** REQ-004 bis REQ-009

---

## `src/queue/queue-manager.ts`

### Klasse `QueueManager`

- Zustand:
  - `queues: Map<number, ChannelQueue>`
  - `advanceCallbacks: QueueAdvanceCallback[]`

### Public Methods

- `onAdvance(callback): void`
  - registriert Advance-Callbacks

- `add(channelId, item): void`
  - fügt Item an Queue-Ende an
  - wirft bei `MAX_QUEUE_SIZE` (50)
  - **REQ:** REQ-004

- `remove(channelId, position): QueueItem | null`
  - 1-basierte Position relativ zum Current
  - bei Entfernen von Position 1: `emitAdvance(next, channelId)`
  - **REQ:** REQ-007

- `skip(channelId): QueueItem | null`
  - `currentIndex++`, danach Advance-Event
  - bei Ende: `clear(channelId)`
  - **REQ:** REQ-008

- `getCurrent(channelId): QueueItem | null`

- `getState(channelId): QueueState`
  - liefert `current`, `upcoming`, `size`
  - **REQ:** REQ-006

- `clear(channelId): void`
  - **REQ:** REQ-010

- `hasItems(channelId): boolean`

### Private Methods

- `getOrCreateQueue(channelId): ChannelQueue`
- `emitAdvance(next, channelId): void`

**REQ:** REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010

---

## `src/stream/yt-dlp.ts`

### Exportierte Typen

- `YtDlpMode = "url" | "title" | "json"`
- `YtDlpBuildOptions`
- `YtDlpLoggers`

### Exportierte Funktionen (pure)

- `isYouTubeUrl(url): boolean`
- `getYtDlpBinaryName(): string`
- `getYtDlpPath(): string`
- `buildYtDlpArgs(options): string[]`
- `parseYtDlpOutput(jsonString): ResolvedVideo`
  - parst JSON robust
  - extrahiert bevorzugt H.264 Videoformat (<=1080p) und Audioformat
  - Fallback auf top-level URL

### Exportierte Runtime-Funktion

- `resolveVideo(sourceUrl, loggers): Promise<ResolvedVideo>`
  - baut JSON-Resolve Command
  - loggt Phasen `RESOLVING` / `RESOLVED` / `FORMAT_SELECTED`
  - fallback auf `-g` URL-Modus bei fehlender Stream-URL

### Interne Funktionen

- `runYtDlp(cmd, loggers)`
- `cookiesExist(cookiesPath)`

**REQ:** REQ-001, REQ-027-A

---

## `src/stream/ffmpeg.ts`

### Exportierte Typen

- `VideoStreamOptions`, `AudioStreamOptions`
- `FfmpegLoggers`
- `SpawnedProcess`
- `YtDlpDownloadOptions`
- `DebugCacheFileOptions`
- `SpawnFfmpegOptions`
- `SpawnFfmpegForHLSOptions`

### Exportierte Funktionen (pure/helper)

- `getFfmpegBinaryName(): string`
- `getFfmpegPath(): string`
- `normalizeVolume(volume): number` (0..1)
- `normalizeBitrate(bitrate?): string`
- `shouldWaitForDownloadComplete(streamType): boolean`
- `buildYtDlpDownloadCmd(options): string[]`
- `buildDebugCacheFileName(options): string`
- `buildTempFilePath(videoId, streamType): string`
- `buildVideoStreamArgs(options): string[]`
  - aktueller Codec: H264 (`libx264`) für RTP
- `buildAudioStreamArgs(options): string[]`
  - Audio Re-Encode nach Opus
  - RTP-Paketgrößen-Schutz: `-frame_duration 20` + `-vbr off`, damit Opus-Payloads unter `pkt_size=1200` bleiben

### Exportierte Runtime-Funktionen

- `spawnFfmpeg(options): Promise<SpawnedProcess>`
  - startet yt-dlp Download in Temp-Datei
  - wartet optional auf Voll-Download (Video i.d.R. ja, Audio nein)
  - wartet auf minimale Dateigröße
  - startet ffmpeg RTP-Prozess
  - parsed/loggt ffmpeg Fortschritt (`frame`, `time`, `speed`, `bitrate`)
  - killt bei Cleanup ffmpeg + yt-dlp
  - **REQ:** REQ-002, REQ-003, REQ-012, REQ-027-B, REQ-027-C

- `testFfmpegBinary(loggers?): Promise<string>`

- `spawnFfmpegForHLS(options): Promise<SpawnedProcess>`
  - HLS-Alternative mit Temp-Downloads Video+Audio + HLS-Ausgabe

### Interne Helper

- `extractYouTubeId(url): string`
- `getDebugCacheDir(): string`

**REQ:** REQ-002, REQ-003, REQ-012, REQ-027-B, REQ-027-C, REQ-032

---

## `src/stream/hls-server.ts`

### Exportierte Interfaces

- `HLSServerConfig`
- `HLSServerHandle`

### Exportierte Funktion

- `startHLSServer(config): Promise<HLSServerHandle>`
  - Serviert `.m3u8` + `.ts`
  - CORS Header aktiv
  - Basic Path-Safety gegen Traversal

**REQ:** REQ-002 (HLS-Variante), REQ-028-B (Status-/Auslieferungskontext)

---

## `src/stream/stream-manager.ts`

### Exportierte Typen

- `TransportLike`, `ProducerLike`, `RouterLike`, `StreamHandleLike`
- `ChannelStreamResources`, `HLSChannelStreamResources`
- `TransportResources`, `ProducerResources`

### Klasse `StreamManager`

#### Public Methods

- `generateSsrc(): number`
- `isActive(channelId): boolean`
- `setActive(channelId, resources): void`
- `setActiveHLS(channelId, resources): void`
- `getResources(channelId): ChannelStreamResources | undefined`
- `getHLSResources(channelId): HLSChannelStreamResources | undefined`
- `pauseChannelStream(channelId): boolean`
  - pausiert Producer (ffmpeg bleibt aktiv)
  - **REQ:** REQ-013
- `resumeChannelStream(channelId): boolean`
  - **REQ:** REQ-013
- `createTransports(router, ip, announcedAddress): Promise<TransportResources>`
  - erstellt PlainTransports (Audio/Video)
  - **REQ:** REQ-002
- `createProducers(router, transports): Promise<ProducerResources>`
  - liest PayloadType bevorzugt aus Router-Capabilities
  - erzeugt Audio/Video Producer
  - **REQ:** REQ-002
- `cleanup(channelId): void`
  - RTP- und HLS-Ressourcen cleanup inkl. Prozesse, Producer, Transports, Stream-Handle
  - **REQ:** REQ-016
- `cleanupAll(): void`
  - **REQ:** REQ-016

#### Private Methods

- `getPayloadTypeFromRouter(router, mimeType, fallback): number`

**REQ:** REQ-002, REQ-003, REQ-013, REQ-015, REQ-016

---

## `src/sync/sync-controller.ts`

### Exportierter Typ

- `StartStreamFn = (channelId: number, item: QueueItem) => Promise<void>`

### Klasse `SyncController`

#### State

- `states: Map<number, { isPlaying; isPaused; volume }>`
- `queueManager` (Dependency)
- `startStream` (injectable callback)

#### Public Methods

- `isPlaying(channelId): boolean`
- `setPlaying(channelId, playing): void`
- `isPaused(channelId): boolean`
- `setPaused(channelId, paused): void`
- `getVolume(channelId): number`
- `setVolume(channelId, volume): void` (clamped 0..100)
- `play(channelId): Promise<void>`
  - startet Current Queue Item
  - **REQ:** REQ-003
- `skip(channelId): Promise<void>`
  - queue skip + start next oder `setPlaying(false)`
  - **REQ:** REQ-008
- `onVideoEnded(channelId): Promise<void>`
  - Auto-Advance wenn playing und nicht paused
  - **REQ:** REQ-009
- `stop(channelId): void`
  - stop state + queue clear
  - **REQ:** REQ-010
- `cleanupChannel(channelId): void`
- `cleanupAll(): void`

#### Private Methods

- `getState(channelId)` (read-only default)
- `getOrCreateState(channelId)`

**REQ:** REQ-003, REQ-008, REQ-009, REQ-010, REQ-012, REQ-013, REQ-016

---

## 3) Commands (`src/commands/*`)

Alle Commands registrieren über `ctx.commands.register(...)`.

- `registerPlayCommand(ctx, queueManager, syncController)` in `play.ts`
  - `/watch <query>`
  - blockiert zweiten Startversuch bei aktiver Wiedergabe im selben Channel
  - Resolve via `resolveVideo`, Queue add, Start (nur wenn kein aktiver Stream)
  - Fehlerpfad entfernt erstes Queue-Item bei Startfehler
  - **REQ:** REQ-001, REQ-004, REQ-035

- `registerQueueCommand(ctx, queueManager)` in `queue.ts`
  - `/queue`
  - formatiert Current + Upcoming + Duration
  - **REQ:** REQ-006

- `registerSkipCommand(ctx, syncController, streamManager?)` in `skip.ts`
  - `/skip`
  - prüft Wiedergabe robust: `isPlaying` **oder** `streamManager.isActive(...)`
  - **REQ:** REQ-008

- `registerRemoveCommand(ctx, queueManager)` in `remove.ts`
  - `/remove <position>`
  - **REQ:** REQ-007

- `registerStopCommand(ctx, syncController, streamManager)` in `stop.ts`
  - `/watch_stop`
  - prüft Wiedergabe robust: `isPlaying` **oder** `streamManager.isActive(...)`
  - stream cleanup + sync stop
  - **REQ:** REQ-010

- `registerNowPlayingCommand(ctx, queueManager)` in `nowplaying.ts`
  - `/nowplaying`
  - **REQ:** REQ-011

- `registerPauseCommand(ctx, syncController, streamControl)` in `pause.ts`
  - `/pause`
  - prüft Wiedergabe robust: `isPlaying` **oder** `streamControl.isActive(...)`
  - toggelt pause/resume über `StreamManager`
  - **REQ:** REQ-013

- `registerResumeCommand(ctx, syncController, streamControl?)` in `resume.ts`
  - `/resume`
  - setzt explizit fort, wenn ein Stream pausiert ist
  - liefert klare Rückmeldung wenn nichts pausiert ist
  - **REQ:** REQ-034

- `registerVolumeCommand(ctx, syncController)` in `volume.ts`
  - `/volume <0-100>`
  - wirkt auf nächste Video-Instanz
  - **REQ:** REQ-012

- `registerDebugCacheCommand(ctx)` in `debug_cache.ts`
  - `/debug_cache`
  - listet Cache-Dateien nach mtime/size
  - gated: nur bei aktivem `debugMode` nutzbar
  - **REQ:** REQ-032, REQ-033

---

## `src/ui/components.tsx`

### Exportierte API

- `components: ComponentsMap`
  - `TOPBAR_RIGHT: [NowPlayingBadge]`
  - `HOME_SCREEN: [QueuePanel]`
  - `ADMIN_SETTINGS: [SettingsPanel]`

### Interne Komponenten

- `NowPlayingBadge()`
  - zeigt Badge + Buttons für Pause/Skip/Stop
  - nutzt Command-Bridge (`executeCommand` aus Props oder globale Bridge), um `/pause`, `/skip`, `/watch_stop` auszulösen
  - zeigt optionalen Vorbereitungsstatus mit Phase/Prozentbalken
  - **REQ-Bezug im UI-Text:** REQ-017, REQ-029, REQ-030, REQ-031

- `QueuePanel()`
  - Basis-Hinweis für Nutzung (`/watch`)
  - **REQ:** REQ-017

- `SettingsPanel()`
  - visuelles Panel für Bitrates, Volume, Sync-Mode, Debug
  - derzeit primär statisch/placeholder
  - **REQ-Bezug im UI-Text:** REQ-018, REQ-026

---

## `src/utils/constants.ts`

- `STREAM_KEY = "vid-with-friends"`
- `DEFAULT_SETTINGS`
  - `BITRATE_VIDEO = 3000`
  - `BITRATE_AUDIO = 128`
  - `DEFAULT_VOLUME = 75`
  - `SYNC_MODE = "server"`
- `AUDIO_CODEC` (Opus/PT111)
- `VIDEO_CODEC` (H264/PT96)
- `PLUGIN_AVATAR_URL`
- `MAX_QUEUE_SIZE = 50`
- `PLUGIN_NAME = "Vid With Friends"`

**REQ:** REQ-002, REQ-003, REQ-018

---

## 4) Reale End-to-End Flows (Ist-Zustand)

### Flow A: `/watch` bis laufender Stream

1. User ruft `/watch <query>`
2. `registerPlayCommand` normalisiert Query (`ytsearch:` bei Suchtext)
3. `resolveVideo(...)` liefert Metadaten + URLs
4. Queue add via `queueManager.add(...)`
5. Wenn nicht playing: `syncController.play(channelId)`
6. `SyncController.play` ruft injiziertes `startStream(...)`
7. `startStream` erstellt Transports/Producer, startet ffmpeg-Prozesse, registriert Stream
8. Stream läuft; Monitoring + HealthCheck aktiv

### Flow B: Auto-Advance

1. Audio-ffmpeg endet (`onEnd` Callback in `spawnFfmpeg`)
2. `syncController.onVideoEnded(channelId)`
3. `queueManager.skip(channelId)`
4. Bei vorhandenem nächsten Item: erneutes `startStream(...)`
5. Sonst `setPlaying(false)`

### Flow C: Stop/Cleanup

- Command `/watch_stop`:
  1. `streamManager.cleanup(channelId)`
  2. `syncController.stop(channelId)`

- Event `voice:runtime_closed`:
  1. `streamManager.cleanup(channelId)`
  2. `syncController.cleanupChannel(channelId)`
  3. `queueManager.clear(channelId)`

- Plugin unload:
  1. `streamManager.cleanupAll()`
  2. `syncController.cleanupAll()`

---

## 5) REQ-Coverage (Implementation Trace)

- **Wiedergabe:** REQ-001, REQ-002, REQ-003, REQ-010, REQ-011, REQ-012, REQ-013, REQ-034, REQ-035
- **Queue:** REQ-004 bis REQ-009
- **Lifecycle/UI/Settings:** REQ-014, REQ-015, REQ-016, REQ-017, REQ-018
- **Debug/Diagnostics:** REQ-026, REQ-027-A, REQ-027-B, REQ-027-C, REQ-032, REQ-033

Hinweis zum Ist-Zustand:
- UI-Komponenten für REQ-029/REQ-030/REQ-031 sind mit einer Command-Bridge verdrahtet; die tatsächliche Ausführung hängt von der Runtime-Bereitstellung dieser Bridge ab.

---

## 6) Auffälligkeiten / Technische Notizen

- In `index.ts` existieren `monitorProcess` und `monitorProcessForAutoAdvance`; der primäre RTP-Auto-Advance läuft derzeit über Audio-`onEnd` in `spawnFfmpeg`.
- `startStream` setzt initial einen Vorbereitungs-Titel (`⏳ ...`) und warnt nach 30s ohne Streaming-Signal (`REQ-028-C`).
- `/debug_cache` ist bewusst an `debugMode` gekoppelt (`REQ-033`).

---

## 7) Kurzfazit

Die Codebasis ist modular getrennt (Queue/Stream/Sync/Commands/UI) und deckt die Kern-REQs für Voice-Channel Watch-Party breit ab. Der produktive Streaming-Pfad ist RTP-basiert mit Temp-File-Ansatz für yt-dlp/ffmpeg und H264+Opus-Codecpfad. Offene Punkte liegen primär in vertiefter Runtime-Integration der UI-Brücke (abhängig vom Host-SDK) und weiterer Nichtfunktions-Feinabstimmung.

---

## 8) Line-by-line Funktionsreferenz

Hinweis: Zeilenangaben referenzieren den Stand dieser Doku-Aktualisierung (03.03.2026).

### `src/index.ts`

- `debugLog` — L50
- `startStream` — L113
- `monitorProducers` — L307
- `scheduleHealthCheck` — L370
- `monitorProcess` — L455
- `monitorProcessForAutoAdvance` — L482
- `handleVoiceRuntimeClosed` — L511
- `onLoad` — L540
- `onUnload` — L650

### `src/queue/queue-manager.ts`

- `QueueManager` (class) — L16
- `onAdvance` — L21
- `add` — L26
- `remove` — L40
- `skip` — L65
- `getCurrent` — L83
- `getState` — L93
- `clear` — L107
- `hasItems` — L112
- `getOrCreateQueue` (private) — L118
- `emitAdvance` (private) — L127

### `src/stream/yt-dlp.ts`

- `isYouTubeUrl` — L37
- `getYtDlpBinaryName` — L43
- `getYtDlpPath` — L47
- `buildYtDlpArgs` — L51
- `parseYtDlpOutput` — L69
- `runYtDlp` (internal) — L166
- `cookiesExist` (internal) — L189
- `resolveVideo` — L203

### `src/stream/ffmpeg.ts`

- `getFfmpegBinaryName` — L86
- `getFfmpegPath` — L90
- `normalizeVolume` — L97
- `normalizeBitrate` — L104
- `shouldWaitForDownloadComplete` — L114
- `buildYtDlpDownloadCmd` — L118
- `buildDebugCacheFileName` — L157
- `buildTempFilePath` — L163
- `extractYouTubeId` (internal) — L171
- `getDebugCacheDir` (internal) — L176
- `buildVideoStreamArgs` — L195
- `buildAudioStreamArgs` — L258
- `spawnFfmpeg` — L307
- `testFfmpegBinary` — L598
- `spawnFfmpegForHLS` — L674

### `src/stream/hls-server.ts`

- `startHLSServer` — L52

### `src/stream/stream-manager.ts`

- `StreamManager` (class) — L101
- `generateSsrc` — L106
- `isActive` — L111
- `setActive` — L116
- `setActiveHLS` — L121
- `getResources` — L126
- `getHLSResources` — L131
- `pauseChannelStream` — L144
- `resumeChannelStream` — L167
- `createTransports` — L185
- `createProducers` — L213
- `getPayloadTypeFromRouter` (private) — L275
- `cleanup` — L293
- `cleanupAll` — L368

### `src/sync/sync-controller.ts`

- `SyncController` (class) — L29
- `isPlaying` — L42
- `setPlaying` — L47
- `isPaused` — L52
- `setPaused` — L57
- `getVolume` — L62
- `setVolume` — L67
- `play` — L77
- `skip` — L91
- `onVideoEnded` — L105
- `stop` — L121
- `cleanupChannel` — L130
- `cleanupAll` — L135
- `getState` (private) — L141
- `getOrCreateState` (private) — L149

### `src/commands/*`

- `registerPlayCommand` — `src/commands/play.ts` L27
- `registerQueueCommand` — `src/commands/queue.ts` L19
- `formatDuration` (queue) — `src/commands/queue.ts` L66
- `registerSkipCommand` — `src/commands/skip.ts` L19
- `registerRemoveCommand` — `src/commands/remove.ts` L19
- `registerStopCommand` — `src/commands/stop.ts` L20
- `registerNowPlayingCommand` — `src/commands/nowplaying.ts` L19
- `formatDuration` (nowplaying) — `src/commands/nowplaying.ts` L45
- `registerPauseCommand` — `src/commands/pause.ts` L24
- `registerResumeCommand` — `src/commands/resume.ts` L25
- `registerVolumeCommand` — `src/commands/volume.ts` L19
- `registerDebugCacheCommand` — `src/commands/debug_cache.ts` L26

### `src/ui/components.tsx`

- `NowPlayingBadge` — L44
- `QueuePanel` — L154
- `SettingsPanel` — L192
- `components` (map export) — L537
