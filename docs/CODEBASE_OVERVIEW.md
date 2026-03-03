# Codebase Overview — sharkord-vid-with-friends

Eine **vollständige, detaillierte Übersicht** aller 8 Kernkomponenten des Plugins mit architektonischen Diagrammen.

---

## 📚 Inhaltsverzeichnis

1. [Schritt 1: Projekt-Struktur](#schritt-1-projekt-Struktur)
2. [Schritt 2: Entry Point (index.ts)](#schritt-2-entry-point)
3. [Schritt 3: Queue-System](#schritt-3-queue-system)
4. [Schritt 4: Stream-System](#schritt-4-stream-system)
5. [Schritt 5: SyncController](#schritt-5-synccontroller)
6. [Schritt 6: Commands](#schritt-6-commands)
7. [Schritt 7: Tests](#schritt-7-tests)
8. [Schritt 8: Konfiguration](#schritt-8-konfiguration)
9. [Gesamtzusammenfassung & Flows](#gesamtzusammenfassung--flows)

---

## Schritt 1: Projekt-Struktur

```
sk_plugin/
├── .github/agents/
│   └── vid-with-friends.agent.md    ← Agent-Instruktionen & Rules
│
├── bin/                              ← Kompilierte Binaries (ffmpeg, yt-dlp)
│
├── docs/
│   ├── ARCHITECTURE.md               ← Detaillierte Architektur
│   ├── REQUIREMENTS.md               ← Alle REQ-001 bis REQ-018
│   ├── CODEBASE_OVERVIEW.md          ← Diese Datei
│   └── conclusions/
│       └── conclusions-YYYY-MM-DD.md ← Tägliche Erkenntnisse
│
├── scripts/
│   └── download-binaries.sh          ← Binary-Download Helper
│
├── src/                              ← HAUPTQUELLCODE
│   ├── index.ts                      ← Plugin Entry Point
│   ├── commands/                     ← 8 User-Befehle
│   │   ├── play.ts (/watch)
│   │   ├── queue.ts (/queue)
│   │   ├── skip.ts (/skip)
│   │   ├── remove.ts (/remove)
│   │   ├── stop.ts (/watch_stop)
│   │   ├── nowplaying.ts (/nowplaying)
│   │   ├── pause.ts (/pause)
│   │   └── volume.ts (/volume)
│   ├── queue/                        ← Warteschlangen-Verwaltung
│   │   ├── queue-manager.ts
│   │   └── types.ts
│   ├── stream/                       ← Video/Audio Streaming
│   │   ├── ffmpeg.ts                 ← RTP-Streaming
│   │   ├── yt-dlp.ts                 ← URL-Auflösung
│   │   └── stream-manager.ts         ← Mediasoup Lifecycle
│   ├── sync/                         ← Orchestrierung
│   │   └── sync-controller.ts
│   ├── ui/
│   │   └── components.tsx            ← React UI-Komponenten
│   └── utils/
│       └── constants.ts              ← Konstanten & Defaults
│
├── tests/
│   ├── unit/                         ← Isolierte Tests
│   ├── integration/                  ← Manager + Context
│   └── docker/                       ← E2E im Container
│
├── docker-compose.dev.yml            ← Docker Development Setup
├── package.json                      ← Bun Dependencies
├── tsconfig.json                     ← TypeScript Config
└── README.md                         ← English Dokumentation
```

### 📌 Key Files

| Datei | Zeile | Zweck |
|-------|-------|-------|
| [src/index.ts](../src/index.ts) | 1-333 | Plugin Lifecycle: onLoad/onUnload, startStream, monitorProcess |
| [src/queue/types.ts](../src/queue/types.ts) | 1-150 | QueueItem, QueueState, ResolvedVideo Types |
| [src/queue/queue-manager.ts](../src/queue/queue-manager.ts) | 1-162 | QueueManager Class: add, skip, remove, clear |
| [src/stream/yt-dlp.ts](../src/stream/yt-dlp.ts) | 1-198 | yt-dlp Wrapper: isYouTubeUrl, buildYtDlpArgs, resolveVideo |
| [src/stream/ffmpeg.ts](../src/stream/ffmpeg.ts) | 1-211 | ffmpeg Wrapper: buildVideoStreamArgs, buildAudioStreamArgs, spawnFfmpeg |
| [src/stream/stream-manager.ts](../src/stream/stream-manager.ts) | 1-235 | StreamManager Class: createTransports, createProducers |
| [src/sync/sync-controller.ts](../src/sync/sync-controller.ts) | 1-162 | SyncController Class: play, skip, onVideoEnded, stop |

---

## Schritt 2: Entry Point (`src/index.ts`)

### 🎯 Verantwortung

- Plugin-Lifecycle: `onLoad()`, `onUnload()`
- Singletons initialisieren (QueueManager, StreamManager, SyncController)
- 8 Commands registrieren
- Event-Listener (voice:runtime_closed)
- Stream-Orchestrierung: `startStream()`, `monitorProcess()`

### 🔄 Lifecycle Diagramm

```
┌──────────────────────────────────────────────────────────┐
│ onLoad(ctx: PluginContext)                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ 1. queueManager = new QueueManager()                     │
│ 2. streamManager = new StreamManager()                   │
│ 3. syncController = new SyncController(...)             │
│ 4. ctx.settings.register([...])                         │
│    - syncMode, videoBitrate, audioBitrate, defaultVolume│
│ 5. registerPlayCommand(ctx, queueManager, syncController)│
│    registerQueueCommand(ctx, queueManager)              │
│    registerSkipCommand(ctx, syncController)             │
│    ... (8 total)                                        │
│ 6. ctx.events.on("voice:runtime_closed", handler)      │
│                                                          │
│ Plugin bereit zum Empfangen von User-Befehlen! ✅      │
└──────────────────────────────────────────────────────────┘
```

### ⚙️ Settings API (REQ-018)

**Korrekte Settings-Struktur für Sharkord v0.0.6:**

```typescript
ctx.settings.register([
  {
    key: string;           // Eindeutiger Schlüssel (z.B. "videoBitrate")
    name: string;          // ⚠️ Label für Sidebar (NICHT "label" oder "title"!)
    type: "string" | "number" | "boolean" | "select";
    description?: string;  // Beschreibung rechts im Panel
    defaultValue: any;     // ⚠️ Default-Wert (NICHT "default"!)
    
    // Optional für type="number":
    min?: number;
    max?: number;
    
    // Optional für type="select":
    options?: Array<{ label: string; value: string }>;
  }
]);
```

**Beispiel:**

```typescript
ctx.settings.register([
  {
    key: "videoBitrate",
    name: "Video-Bitrate (kbps)",        // ← Wird in Sidebar angezeigt
    type: "string",
    description: "Controlls video quality...",
    defaultValue: "2000k",               // ← NICHT "default"!
  },
  {
    key: "defaultVolume",
    name: "Standard-Lautstärke (%)",
    type: "number",
    description: "Default playback volume...",
    defaultValue: 50,
    min: 0,
    max: 100,
  },
]);
```

**⚠️ Häufige Fehler:**
- ❌ `label:` statt `name:` → Sidebar zeigt nur "string", "number", etc.
- ❌ `default:` statt `defaultValue:` → Einstellung hat keinen Default-Wert
- ❌ `title:` statt `name:` → Funktioniert nicht

**Settings abrufen:**

```typescript
const videoBitrate = ctx.settings.get<string>("videoBitrate") ?? "2000k";
const debugMode = ctx.settings.get<boolean>("debugMode") ?? false;
```

### 🎬 startStream() Flow

```
startStream(ctx, channelId, item)
  │
  ├─ 1. streamManager.cleanup(channelId)
  │      ↓ Alte Ressourcen killen
  │
  ├─ 2. router = ctx.actions.voice.getRouter(channelId)
  │      ↓ Mediasoup Router holen
  │
  ├─ 3. transports = streamManager.createTransports(router, ip, announcedAddress)
  │      ↓ 2 Transports (Audio + Video)
  │
  ├─ 4. producers = streamManager.createProducers(transports)
  │      ↓ 2 Producer (Audio + Video)
  │
  ├─ 5. streamHandle = ctx.actions.voice.createStream({...})
  │      ↓ Sharkord registriert Stream
  │
  ├─ 6. videoProcess = spawnFfmpeg(buildVideoStreamArgs(...))
  │      ↓ ffmpeg -re -i item.streamUrl -c:v libx264 -f rtp rtp://...
  │      ↓ Sendet H264 Video-Frames via RTP
  │
  ├─ 7. audioProcess = spawnFfmpeg(buildAudioStreamArgs(...))
  │      ↓ ffmpeg -re -i item.streamUrl -c:a libopus -f rtp rtp://...
  │      ↓ Sendet Opus Audio-Frames via RTP
  │
  ├─ 8. streamManager.setActive(channelId, {
  │        audioTransport, videoTransport,
  │        audioProducer, videoProducer,
  │        videoProcess, audioProcess,
  │        streamHandle, router
  │      })
  │      ↓ Speichert alle Ressourcen für spätere Cleanup
  │
  └─ 9. monitorProcess(ctx, channelId, videoProcess)
         ↓ Wartet auf videoProcess.exited
         ↓ wenn EXIT → onVideoEnded() → Auto-Advance!
```

### 🧹 Cleanup (onUnload & voice:runtime_closed)

```
onUnload(ctx) / handleVoiceRuntimeClosed(ctx)
  │
  ├─ streamManager.cleanup(channelId) / cleanupAll()
  │   ├─ Alle ffmpeg-Prozesse: kill(SIGTERM)
  │   ├─ Alle Producers: close()
  │   ├─ Alle Transports: close()
  │   └─ Alle Streams: streamHandle.remove()
  │
  ├─ syncController.cleanupChannel(channelId) / cleanupAll()
  │   └─ Alle State (isPlaying, isPaused, volume)
  │
  └─ queueManager.clear(channelId)
      └─ Queue leeren
```

---

## Schritt 3: Queue-System

### 📊 Types

```typescript
// Ein Video in der Queue
QueueItem {
  id: string                 // UUID
  query: string             // Original-Suchbegriff
  title: string             // Aufgelöster Titel
  streamUrl: string         // Direkte Stream-URL
  duration: number          // Sekunden
  thumbnail: string         // Vorschaubild-URL
  addedBy: number           // Benutzer-ID
  addedAt: number           // Millisekunden-Timestamp
}

// Status einer Channel-Queue
QueueState {
  current: QueueItem | null     // Gerade spielend
  upcoming: QueueItem[]         // Nächste Videos
  size: number                  // Gesamt-Anzahl
}

// Per-Channel interne Struktur
ChannelQueue {
  items: QueueItem[]
  currentIndex: number    // ← Zeiger auf aktuelles Video
}
```

### 🎯 QueueManager Methoden

```typescript
class QueueManager {
  // ──── CORE OPERATIONS ────
  add(channelId, item)
    → queue.items.push(item)
    → Wirft Error wenn queue.length >= 50

  skip(channelId)
    → currentIndex++
    → emitAdvance() → SyncController.skip()
    → return next Item oder null

  remove(channelId, position)
    → position 1 = current, 2 = first upcoming, etc
    → items.splice(currentIndex + position - 1, 1)
    → if position == 1: emitAdvance()

  getCurrent(channelId)
    → return items[currentIndex] ?? null

  getState(channelId)
    → return { current, upcoming, size }

  clear(channelId)
    → queues.delete(channelId)

  hasItems(channelId)
    → return getState(channelId).size > 0

  // ──── CALLBACKS ────
  onAdvance(callback)
    → Registriert Listener
    → Wird aufgerufen bei skip/remove current
    → callback(next, channelId)
}
```

### 📋 Beispiel: Multi-Channel Queues

```
Channel #123:
  Queue: [Video1, Video2, Video3, Video4, Video5]
         ↑ currentIndex = 0
  → getCurrent() = Video1
  → getState() = { current: Video1, upcoming: [V2, V3, V4, V5], size: 5 }

Channel #456:
  Queue: [VideoA, VideoB]
         ↑ currentIndex = 1
  → getCurrent() = VideoB
  → getState() = { current: VideoB, upcoming: [], size: 2 }

Channel #789:
  Queue: []
  → getCurrent() = null
  → getState() = { current: null, upcoming: [], size: 0 }
```

---

## Schritt 4: Stream-System

Besteht aus **3 Teilen:**

### 4a) yt-dlp.ts — URL-Auflösung

```typescript
// Pure Functions (testbar ohne Binary)
isYouTubeUrl(url)             → boolean
getYtDlpBinaryName()          → "yt-dlp" | "yt-dlp.exe"
getYtDlpPath()                → Path zu Binary
buildYtDlpArgs(options)       → string[] CLI-Args
parseYtDlpOutput(json)        → ResolvedVideo

// Runtime Function (braucht Binary)
resolveVideo(url, loggers)    → Promise<ResolvedVideo>
```

**Flow:**

```
Input:  "rick astley" oder "https://youtube.com/watch?v=xyz"
  │
  ├─ isYouTubeUrl() = true
  │  ↓
  ├─ Normalize: "rick astley" → "ytsearch:rick astley"
  │  ↓
  ├─ buildYtDlpArgs({
  │    ytDlpPath: "/path/to/yt-dlp",
  │    sourceUrl: "ytsearch:rick astley",
  │    mode: "json"
  │  })
  │  → ["yt-dlp", "--dump-json", "ytsearch:rick astley"]
  │  ↓
  ├─ Bun.spawn({ cmd: [...] })
  │  → yt-dlp läuft
  │  → Kontaktiert YouTube
  │  → Gibt JSON zurück
  │  ↓
  ├─ parseYtDlpOutput(json)
  │  → {
  │      title: "Rick Astley - Never Gonna Give You Up",
  │      streamUrl: "http://manifest.m3u8?key=...",
  │      audioUrl: "...",
  │      duration: 213,
  │      thumbnail: "http://..."
  │    }
  │  ↓
Output: ResolvedVideo ✅
```

### 4b) ffmpeg.ts — RTP-Streaming

```typescript
// Pure Functions
getFfmpegBinaryName()         → "ffmpeg" | "ffmpeg.exe"
getFfmpegPath()               → Path zu Binary
normalizeVolume(0-100)        → 0-1 float
normalizeBitrate(bitrate)     → "192k"
buildVideoStreamArgs(opts)    → string[]
buildAudioStreamArgs(opts)    → string[]

// Runtime Function
spawnFfmpeg(args, loggers)    → SpawnedProcess
killProcess(process)          → void
```

**Video RTP Args:**

```bash
ffmpeg \
  -hide_banner -nostats -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 \    # Auto-Reconnect
  -re                                      # Real-time playback
  -i "http://manifest.m3u8?key=xyz"       # Input URL
  -an                                      # No audio
  -c:v libx264                             # Video codec
  -preset ultrafast                        # CPU Usage
  -tune zerolatency                        # Low latency
  -b:v 2000k -maxrate 2000k                # Bitrate
  -pix_fmt yuv420p                         # Pixel format
  -payload_type 96                         # RTP payload type
  -ssrc 123456789                          # Sync source (SSRC)
  -f rtp                                   # Output format
  rtp://10.0.0.1:40001?pkt_size=1200       # RTP destination
```

**Audio RTP Args:**

```bash
ffmpeg \
  ... (same reconnect args)
  -re \
  -i "http://manifest.m3u8?key=xyz"       # SAME URL!
  -vn                                      # No video
  -af "volume=0.8"                         # Audio volume filter
  -c:a libopus                             # Audio codec
  -ar 48000 -ac 2                          # Sample rate + channels
  -b:a 128k                                # Audio bitrate
  -payload_type 111                        # RTP payload type
  -ssrc 987654321                          # Different SSRC
  -f rtp \
  rtp://10.0.0.1:40002?pkt_size=1200       # Different port!
```

**Synchronisation:**
- Beide ffmpeg-Prozesse lesen von der **GLEICHEN URL**
- Starten zur **GLEICHE ZEIT**
- → Frames sind **synchronisiert** ⏱️

### 4c) stream-manager.ts — Mediasoup Lifecycle

```typescript
class StreamManager {
  // Manage per-channel resources
  activeStreams = Map<number, ChannelStreamResources>

  generateSsrc()                              → number
  isActive(channelId)                         → boolean
  setActive(channelId, resources)             → void
  getResources(channelId)                     → ChannelStreamResources
  cleanup(channelId)                          → void
  cleanupAll()                                → void

  async createTransports(router, ip, announcedAddress)
    → Creates 2 PlainTransports (audio + video)
    → Returns: { audioTransport, videoTransport, audioSsrc, videoSsrc }

  async createProducers(transports)
    → Binds 2 Producers to Transports
    → Returns: { audioProducer, videoProducer }
}
```

**Types:**

```typescript
interface ChannelStreamResources {
  audioTransport: TransportLike
  videoTransport: TransportLike
  audioProducer: ProducerLike
  videoProducer: ProducerLike
  audioProcess: SpawnedProcess | null
  videoProcess: SpawnedProcess | null
  streamHandle: StreamHandleLike | null
  router: RouterLike
}
```

**Lifecycle:**

```
startStream()
  │
  ├─ streamManager.createTransports(router, ip, announcedAddress)
  │   ├─ router.createPlainTransport({ listenIp, rtcpMux: true })
  │   │  → audioTransport
  │   ├─ router.createPlainTransport({ listenIp, rtcpMux: true })
  │   │  → videoTransport
  │   └─ return { audioTransport, videoTransport, audioSsrc, videoSsrc }
  │
  ├─ streamManager.createProducers(transports)
  │   ├─ audioTransport.produce({
  │   │    kind: "audio",
  │   │    rtpParameters: AUDIO_CODEC.rtpParameters
  │   │  })
  │   │  → audioProducer
  │   ├─ videoTransport.produce({
  │   │    kind: "video",
  │   │    rtpParameters: VIDEO_CODEC.rtpParameters
  │   │  })
  │   │  → videoProducer
  │   └─ return { audioProducer, videoProducer }
  │
  └─ streamManager.setActive(channelId, {
      audioTransport, videoTransport,
      audioProducer, videoProducer,
      videoProcess, audioProcess,
      streamHandle, router
    })
```

### 🌐 **WebRTC Network Architecture & Critical Fix**

**Problem:** Verwechslung zwischen **internem RTP-Routing** und **externem WebRTC-Routing**

#### ❌ Fehlerhafte Implementierung (früher)

Die ursprüngliche Implementierung verwendete `announcedAddress` für **beide** Zwecke:
- RTP-Streaming von ffmpeg zu Mediasoup (Container-intern)
- WebRTC-ICE-Candidates für Browser (extern)

```typescript
// index.ts (FALSCH)
const rtpTargetHost = announcedAddress || (ip === "0.0.0.0" ? "127.0.0.1" : ip);
```

**Symptome:**
- Mit `announcedAddress=127.0.0.1`: Browser versuchte zu seinem eigenen localhost zu verbinden → WebRTC Consumer Transport failed
- Mit `announcedAddress=<LAN-IP>`: ffmpeg sendete RTP an externe IP → Mediasoup erhielt keine Pakete

#### ✅ Korrekte Implementierung (jetzt)

**Zwei getrennte Netzwerk-Pfade:**

```typescript
// index.ts (KORREKT)
// RTP target is always local (ffmpeg runs in same container as Mediasoup)
const rtpTargetHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;
```

**1. RTP Path (intern):**
- ffmpeg → Mediasoup RTP Ingest
- Ziel: `127.0.0.1` (Mediasoup Worker im gleichen Container)
- Transport: PlainTransport mit `comedia: true`

**2. WebRTC Path (extern):**
- Mediasoup → Browser WebRTC Consumer
- Announced Address: Host LAN-IP (z.B. `192.168.192.1`)
- Transport: WebRtcTransport mit DTLS/SRTP

#### 📊 Netzwerk-Diagramm

```
┌─────────────────────────────────────────────────┐
│          Docker Container (sharkord-dev)        │
│                                                 │
│  ┌──────────┐   RTP   ┌────────────────────┐  │
│  │  ffmpeg  │─────────→│ Mediasoup Worker   │  │
│  └──────────┘ 127.0.0.1│                    │  │
│                         │ listenIp: 0.0.0.0  │  │
│                         │ announcedIp: <LAN> │  │
│                         └──────────┬─────────┘  │
│                                    │            │
└────────────────────────────────────┼────────────┘
                                     │ WebRTC
                                     │ (UDP 40000-40100)
                                     │ ICE Candidate: <LAN-IP>
                                     ▼
                           ┌──────────────────┐
                           │   Browser Client │
                           │   (Host-Netz)    │
                           └──────────────────┘
```

**Wichtig:** `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS` muss die **Host-LAN-IP** sein (z.B. `192.168.192.1`), NICHT `127.0.0.1`!

---

## Schritt 5: SyncController

### 📊 State pro Channel

```typescript
type ChannelSyncState {
  isPlaying: boolean     // Läuft gerade was?
  isPaused: boolean      // Ist es pausiert?
  volume: number         // 0-100
}
```

### 🎯 Methoden

```typescript
class SyncController {
  private states = Map<number, ChannelSyncState>
  private queueManager: QueueManager
  private startStream: (channelId, item) => Promise<void>

  // ─── STATE ACCESSORS ───
  isPlaying(channelId)                      → boolean
  setPlaying(channelId, playing)            → void
  isPaused(channelId)                       → boolean
  setPaused(channelId, paused)              → void
  getVolume(channelId)                      → number (0-100)
  setVolume(channelId, volume)              → void

  // ─── ACTIONS ───
  async play(channelId)
    → if current is null: throw "Queue empty"
    → setPlaying(true)
    → await startStream(channelId, current)

  async skip(channelId)
    → next = queueManager.skip(channelId)
    → if next: await startStream(channelId, next)
    → else: setPlaying(false)

  async onVideoEnded(channelId)
    → if not isPlaying or isPaused: return
    → next = queueManager.skip(channelId)
    → if next: await startStream(channelId, next)
    → else: setPlaying(false)

  stop(channelId)
    → setPlaying(false)
    → setPaused(false)
    → queueManager.clear(channelId)

  // ─── CLEANUP ───
  cleanupChannel(channelId)                 → void
  cleanupAll()                              → void
}
```

### 🔄 State Machine Diagramm

```
                    isPlaying=false
                         ↑
                         │ stop()
                         │
                    (Initial State)
                         ↑
                         │ play()
                         ↓
                    ┌─────────────────┐
                    │ isPlaying=true  │
                    │ isPaused=false  │ ← LÄUFT
                    └─────────────────┘
                         ↑     ↓
              pause() ────┤     ├──── skip() / onVideoEnded()
                         ↓     ↑
                    ┌─────────────────┐
                    │ isPlaying=true  │
                    │ isPaused=true   │ ← PAUSIERT
                    └─────────────────┘
                         │ (nur setVolume/setPlayingzu false)
```

### ⚠️ Wichtig: Pause ist UI-Level

**Das macht pause():**
```typescript
isPaused = !isPaused  // nur ein Bool!
```

**Das macht pause() NICHT:**
- ❌ ffmpeg Process paused nicht
- ❌ RTP Streams stoppen nicht
- ✅ Video läuft weiter am Server
- ✅ Aber Client zeigt "paused" UI
- ✅ Auto-Advance wird nicht ausgelöst

---

## Schritt 6: Commands

### 📋 Übersicht aller 8 Commands

| Befehl | Datei | Arg | REQ | Funktion |
|--------|-------|-----|-----|----------|
| `/watch <query>` | play.ts | string | REQ-001, 004 | Starten/Enqueue Video |
| `/queue` | queue.ts | — | REQ-006 | Zeige Queue |
| `/skip` | skip.ts | — | REQ-008 | Nächstes Video |
| `/remove <pos>` | remove.ts | number | REQ-007 | Lösche aus Queue |
| `/watch_stop` | stop.ts | — | REQ-010 | Stoppe alles |
| `/nowplaying` | nowplaying.ts | — | REQ-005 | Info aktuelles Video |
| `/pause` | pause.ts | — | REQ-013 | Pausiere/Resume |
| `/volume <0-100>` | volume.ts | number | REQ-012 | Lautstärke |

### 🎬 /watch <query> — Der Hauptbefehl (REQ-001, REQ-004)

```
User Typing: /watch "rick astley"
                ↓
1. Validierung
   if !voiceChannel: throw "Must be in voice channel"
   if !args.query: throw "Missing query"

2. Normalisierung
   query = "rick astley"
   isYouTubeUrl? Nein → query = "ytsearch:rick astley"

3. Auflösen (yt-dlp)
   resolved = await resolveVideo("ytsearch:rick astley")
   → { title, streamUrl, duration, thumbnail }

4. QueueItem erstellen
   item = {
     id: UUID,
     query: "rick astley",
     title: "Rick Astley - Never Gonna Give You Up",
     streamUrl: "http://manifest.m3u8?key=...",
     duration: 213,
     thumbnail: "...",
     addedBy: userId,
     addedAt: Date.now()
   }

5. Zur Queue oder Spielen?
   if syncController.isPlaying(channelId):
     queueManager.add(channelId, item)  // Enqueue
     return "Added to queue: ..."
   else:
     queueManager.add(channelId, item)  // Add
     await syncController.play(channelId) // Play
     return "Now playing: ..."
```

### 📋 /queue — Display Queue (REQ-006)

```
User Typing: /queue
                ↓
1. Get State
   state = queueManager.getState(channelId)
   → { current, upcoming, size }

2. Format
   lines = [
     "▶ Now playing: Rick Astley (3:33)",
     "",
     "Up next:",
     "  2. Britney Spears (3:35)",
     "  3. Michael Jackson (4:12)",
     "",
     "3 videos in queue"
   ]

3. Return Message
   return lines.join("\n")
```

**Output:**
```
▶ Now playing: Rick Astley - Never Gonna Give You Up (3:33)

Up next:
  2. Britney Spears - ...Baby One More Time (3:35)
  3. Michael Jackson - Billie Jean (4:12)

3 videos in queue
```

### ⏭ /skip (REQ-008)

```
User: /skip
         ↓
if !syncController.isPlaying(): return "Nothing playing"
         ↓
await syncController.skip(channelId)
  → queueManager.skip() (currentIndex++)
  → startStream(channelId, next) OR setPlaying(false)
         ↓
return "Skipped."
```

### ❌ /remove <position> (REQ-007)

```
User: /remove 2
        ↓
if position < 1: throw Error
        ↓
removed = queueManager.remove(channelId, position)
        ↓
if !removed: return "Invalid position"
        ↓
return `Removed: ${removed.title}`
```

**Position numbering:**
```
/queue output:
  1. Rick Astley (current)
  2. Britney Spears
  3. Michael Jackson

/remove 2 → Entfernt Britney Spears
/remove 1 → Entfernt Rick Astley + advance!
```

### ⏹ /watch_stop (REQ-010)

```
User: /watch_stop
         ↓
syncController.stop(channelId)
  → setPlaying(false)
  → setPaused(false)
  → queueManager.clear(channelId)
         ↓
return "Stopped playback and cleared queue."
```

### 🎬 /nowplaying (REQ-005)

```
User: /nowplaying
          ↓
current = queueManager.getCurrent(channelId)
          ↓
if !current: return "Nothing playing"
          ↓
return `Now playing: ${current.title} (${current.duration}s)
Added by: <@${current.addedBy}>`
```

### ⏸ /pause (REQ-013)

```
User: /pause (while playing)
        ↓
isPaused = syncController.isPaused(channelId)
        ↓
syncController.setPaused(channelId, !isPaused)
        ↓
return isPaused ? "Resumed" : "Paused"
```

**Important:** Pause ist nur UI-State!
- ffmpeg läuft weiter
- Auto-Advance wird blockiert

### 🔊 /volume <0-100> (REQ-012)

```
User: /volume 50
         ↓
if level < 0 || level > 100: throw Error
         ↓
syncController.setVolume(channelId, level)
  → state.volume = Math.min(100, Math.max(0, level))
         ↓
return "Volume set to 50%"
         ↓
(Applies to NEXT video!)
```

---

## Schritt 7: Tests

### 🏗️ Test-Struktur

```
tests/
├── unit/                              ← Pure Logic (no Sharkord deps)
│   ├── queue-manager.test.ts          ← QueueManager (REQ-004-010)
│   ├── sync-controller.test.ts        ← SyncController (REQ-003, 008-013)
│   ├── commands.test.ts               ← All 8 Commands (REQ-001-008, 012-013)
│   ├── ffmpeg.test.ts                 ← ffmpeg args builders
│   ├── yt-dlp.test.ts                 ← yt-dlp args builders
│   └── stream-manager.test.ts         ← Transports + Producers
│
├── integration/
│   ├── mock-plugin-context.ts         ← Mock Sharkord API (NO @sharkord SDK needed!)
│   └── plugin-lifecycle.test.ts       ← onLoad/onUnload (REQ-014-016)
│
└── docker/
    ├── Dockerfile.test                ← Test Container (ffmpeg + yt-dlp)
    ├── docker-compose.yml             ← Test Orchestration
    └── e2e-smoke.test.ts              ← E2E in Docker (REQ-001, 002, 015)
```

### ✅ Test Pattern

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { QueueManager } from "../../src/queue/queue-manager";

describe("QueueManager", () => {
  let queue: QueueManager;
  const channelId = 42;

  beforeEach(() => {
    queue = new QueueManager();  // Fresh instance each test
  });

  it("[REQ-004] should add a video to the queue", () => {
    const item = makeItem({ title: "Video A" });
    queue.add(channelId, item);

    const state = queue.getState(channelId);
    expect(state.size).toBe(1);
    expect(state.current?.title).toBe("Video A");
  });

  it("[REQ-005] should isolate queues per channel", () => {
    queue.add(1, makeItem({ title: "Channel A" }));
    queue.add(2, makeItem({ title: "Channel B" }));

    expect(queue.getState(1).current?.title).toBe("Channel A");
    expect(queue.getState(2).current?.title).toBe("Channel B");
  });
});
```

**Wichtig:**
- ✅ Jeder Test hat [REQ-ID]
- ✅ Keine externe Dependencies
- ✅ beforeEach für isolierte Tests
- ✅ Assert nur eine Sache pro Test

### 🐳 Docker E2E Tests

```bash
bun run test:docker
  ↓
docker compose -f tests/docker/docker-compose.yml up
  ↓
image: sharkord:v0.0.6 + ffmpeg + yt-dlp
  ↓
bun test (im Container, ffmpeg/yt-dlp verfügbar!)
  ↓
Tests kann ffmpeg/yt-dlp wirklich spawnen
```

### 🔄 TDD Workflow

```
1. Schreibe Test ZUERST
   it("[REQ-009] should auto-advance when video ends")
   → Test FAILS

2. Implementiere minimal
   async onVideoEnded(channelId) {
     const next = queueManager.skip(channelId);
     if (next) await startStream(channelId, next);
   }
   → Test PASSES ✅

3. Refactor (optional)
   Tests müssen immer grün bleiben

4. Commit
   git commit -m "feat(REQ-009): implement auto-advance"
```

---

## Schritt 8: Konfiguration

### 📦 package.json

```json
{
  "name": "sharkord-vid-with-friends",
  "version": "0.0.1",
  "module": "src/index.ts",     // Entry für Bun
  "type": "module",              // ES6 Module
  
  "sharkord": {
    "entry": "index.js",         // Nach Build
    "description": "..."
  },
  
  "scripts": {
    "build": "bun build src/index.ts --outdir dist/ --target bun --minify",
    "test": "bun test",
    "test:docker": "docker compose -f tests/docker/docker-compose.yml up",
    "lint": "tsc --noEmit"
  },
  
  "dependencies": {
    "zod": "^4.3.5"
  }
}
```

**Build Output:**
```
dist/sharkord-vid-with-friends/
├── index.js           ← Minified Bundle
├── package.json       ← Manifest
└── bin/               ← ffmpeg, yt-dlp (from Docker)
    ├── ffmpeg
    └── yt-dlp
```

### 🔧 tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",         // Behält import/export bei
    "jsx": "react-jsx",           // React 19
    
    "strict": true,               // STRICT MODE
    "noEmit": true,               // Bun kompiliert
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  },
  
  "paths": {
    "@/*": ["./src/*"],
    "@tests/*": ["./tests/*"]
  }
}
```

### 🐳 docker-compose.dev.yml

**Service 1: init-binaries** — Download ffmpeg + yt-dlp

```yaml
init-binaries:
  image: alpine:latest
  command:
    - -c
    - |
      BIN_DIR=/binaries
      if [ -f "$BIN_DIR/ffmpeg" ] && [ -f "$BIN_DIR/yt-dlp" ]; then exit 0; fi
      apk add --no-cache wget xz
      wget -O "$BIN_DIR/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
      chmod +x "$BIN_DIR/yt-dlp"
      wget -O /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
      tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1
      cp /tmp/ffmpeg-extract/ffmpeg "$BIN_DIR/ffmpeg"
      chmod +x "$BIN_DIR/ffmpeg"
  volumes:
    - plugin-binaries:/binaries
```

**Service 2: sharkord** — Run Sharkord mit Plugin

```yaml
sharkord:
  image: sharkord/sharkord:v0.0.6
  depends_on:
    init-binaries:
      condition: service_completed_successfully
  ports:
    - "3000:3000"                            # Web UI
    - "40000-40100:40000-40100/udp"          # WebRTC RTP
  environment:
    - SHARKORD_PORT=3000
    - SHARKORD_DEBUG=true
    - SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=192.168.192.1  # ⚠️ Host LAN IP (nicht 127.0.0.1!)
  volumes:
    - sharkord-data:/root/.config/sharkord   # Persist DB
    - ./dist/sharkord-vid-with-friends:/root/.config/sharkord/plugins/sharkord-vid-with-friends:ro
    - plugin-binaries:/root/.config/sharkord/plugins/sharkord-vid-with-friends/bin:ro
```

**Volume Mapping:**
```
Host                              Container
./dist/.../                       /root/.config/sharkord/plugins/.../
  └── index.js (Plugin)
  └── bin/                        /root/.config/.../bin/
      ├── ffmpeg                  (from plugin-binaries)
      └── yt-dlp
```

### 🚀 Quick Start

```bash
# 1. Build
bun run build

# 2. Start Docker
docker compose -f docker-compose.dev.yml up

# 3. Open
http://localhost:3000

# 4. Test
/watch "rick astley"
/queue
/skip

# 5. Stop
docker compose -f docker-compose.dev.yml down
```

---

## Gesamtzusammenfassung & Flows

### 🎯 Architektur Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                        Plugin Entry (index.ts)                  │
├─────────────────────────────────────────────────────────────────┤
│  onLoad(ctx)                                                    │
│    │                                                            │
│    ├─ Singletons Init                                           │
│    │  ├─ queueManager = new QueueManager()                      │
│    │  ├─ streamManager = new StreamManager()                    │
│    │  └─ syncController = new SyncController(...)              │
│    │                                                            │
│    └─ Register 8 Commands ──────┐                              │
│                                  │                              │
│                                  └─→ User Typing /watch, /skip, etc.
│                                     (src/commands/*.ts)
│
└─────────────────────────────────────────────────────────────────┘
                 ↓
        ┌────────┴────────┐
        ↓                 ↓
   ┌─────────────┐   ┌──────────────┐
   │   QueueMgr  │   │ SyncController│
   ├─────────────┤   ├──────────────┤
   │add(item)    │   │play()        │
   │skip()       │   │skip()        │
   │remove(pos)  │   │stop()        │
   │getState()   │   │on→VideoEnded()
   │clear()      │   └──────────────┘
   └─────────────┘        ↓
                    await startStream()
                          ↓
                    ┌──────────────────────────┐
                    │   StreamManager          │
                    ├──────────────────────────┤
                    │createTransports()        │
                    │createProducers()        │
                    │cleanup()                │
                    └──────────────────────────┘
                          ↓
                    ┌──────────────────────────┐
                    │ Spawn 2 ffmpeg Processes │
                    ├──────────────────────────┤
                    │ ffmpeg (Video RTP)      │
                    │ ffmpeg (Audio RTP)      │
                    │ monitorProcess()        │
                    └──────────────────────────┘
```

### 🎬 **Complete /watch Flow**

```
User: /watch "rick astley"
│
├─ [Command Handler] play.ts:executes()
│
├─ 1. Validate
│   └─ Check: in voice channel? ✅
│
├─ 2. Normalize Query
│   └─ "rick astley" → "ytsearch:rick astley"
│
├─ 3. Resolve (yt-dlp)
│   ├─ buildYtDlpArgs()
│   ├─ Bun.spawn(["yt-dlp", "--dump-json", "ytsearch:rick astley"])
│   ├─ yt-dlp contacts YouTube
│   ├─ parseYtDlpOutput()
│   └─ ResolvedVideo = { title, streamUrl, duration, thumbnail }
│
├─ 4. Create QueueItem
│   └─ item = { id, query, title, streamUrl, duration, thumbnail, addedBy, addedAt }
│
├─ 5. Check Playing Status
│   ├─ isPlaying?
│   │  YES → queueManager.add(channelId, item) → return "Added to queue"
│   │  NO  → continue (add + play)
│
├─ 6. Add to Queue
│   └─ queueManager.add(channelId, item)
│       queue.items.push(item), currentIndex = 0
│
├─ 7. Start Playing
│   └─ syncController.play(channelId)
│       ├─ setPlaying(true)
│       └─ await startStream(ctx, channelId, item)
│
├─ 8. startStream() [index.ts]
│   ├─ streamManager.cleanup(channelId)  // Kill old streams
│   ├─ router = ctx.actions.voice.getRouter(channelId)
│   ├─ transports = createTransports(router, ip, announcedAddress)
│   │   ├─ audioTransport = router.createPlainTransport(...)
│   │   └─ videoTransport = router.createPlainTransport(...)
│   ├─ producers = createProducers(transports)
│   │   ├─ audioProducer = audioTransport.produce({kind: "audio", ...})
│   │   └─ videoProducer = videoTransport.produce({kind: "video", ...})
│   ├─ streamHandle = ctx.actions.voice.createStream({
│   │    channelId, key, title, avatarUrl,
│   │    producers: { audio: audioProducer, video: videoProducer }
│   │  })
│   ├─ volume = syncController.getVolume(channelId) / 100
│   │
│   ├─ 9. Spawn Video ffmpeg
│   │   ├─ buildVideoStreamArgs({
│   │   │   sourceUrl: item.streamUrl,
│   │   │   rtpHost: ip, rtpPort: 40001,
│   │   │   payloadType: 96, ssrc: 123..., bitrate: "2000k"
│   │   │ })
│   │   │ → ["ffmpeg", "-re", "-i", "http://...", "-c:v", "libx264", "-f", "rtp", "rtp://10.0.0.1:40001"]
│   │   ├─ videoProcess = spawnFfmpeg(args, loggers)
│   │   │  → Bun.spawn({ cmd: [...] })
│   │   │  → ffmpeg startet, liest Frames von item.streamUrl
│   │   │  → Sendet H264 RTP Pakete zu 10.0.0.1:40001
│   │   │  → Loggers pipen stderr für Exception-Handling
│   │
│   ├─ 10. Spawn Audio ffmpeg
│   │   ├─ buildAudioStreamArgs({
│   │   │   sourceUrl: item.streamUrl,  # SAME URL!
│   │   │   rtpHost: ip, rtpPort: 40002,
│   │   │   payloadType: 111, ssrc: 456..., bitrate: "128k",
│   │   │   volume: 0.8 or 0.5 etc.
│   │   │ })
│   │   │ → ["ffmpeg", "-re", "-i", "http://...", "-c:a", "libopus", "-af", "volume=0.8", "-f", "rtp", "rtp://10.0.0.1:40002"]
│   │   ├─ audioProcess = spawnFfmpeg(args, loggers)
│   │   │  → ffmpeg startet, liest GLEICHE URL von item.streamUrl
│   │   │  → Sendet Opus RTP Pakete zu 10.0.0.1:40002
│   │   │  → Beide ffmpeg starten zur gleichen Zeit → Synchronisation! ⏱️
│   │
│   ├─ 11. Store Resources
│   │   └─ streamManager.setActive(channelId, {
│   │       audioTransport, videoTransport,
│   │       audioProducer, videoProducer,
│   │       videoProcess, audioProcess,
│   │       streamHandle, router
│   │     })
│   │
│   └─ 12. Monitor ffmpeg Exit (Auto-Advance)
│       ├─ monitorProcess(ctx, channelId, videoProcess)
│       ├─ videoProcess.process.exited
│       │  .then(async () => {
│       │    streamManager.cleanup(channelId)  // Kill all resources
│       │    await syncController.onVideoEnded(channelId)
│       │      ├─ if !isPlaying || isPaused: return
│       │      ├─ next = queueManager.skip(channelId)
│       │      └─ if next: await startStream(ctx, channelId, next)
│       │  })
│       │
│       └─ Video läuft und Auto-Advance ist ready! ✅
```

### 🔄 **Auto-Advance Flow (onVideoEnded)**

```
Video 1 läuft... (140 Sekunden)
│
├─ ffmpeg liest Frame by Frame
│  └─ 140s: Letzter Frame, ffmpeg stoppt
│
├─ videoProcess.process.exited triggered
│  └─ monitorProcess detection!
│
├─ monitorProcess()
│  └─ streamManager.cleanup(channelId)
│     ├─ videoProcess.kill(SIGTERM)
│     ├─ audioProcess.kill(SIGTERM)
│     ├─ videoProducer.close()
│     ├─ audioProducer.close()
│     ├─ videoTransport.close()
│     ├─ audioTransport.close()
│     └─ streamHandle.remove()
│
├─ syncController.onVideoEnded(channelId)
│  └─ if !isPlaying || isPaused: return
│  └─ next = queueManager.skip(channelId)
│     └─ currentIndex++ → getCurrent() = Video 2
│  └─ await startStream(ctx, channelId, Video2)
│
└─ Video 2 SOFORT starten!
   └─ Neue transports, producers, ffmpeg
   └─ Kein Unterbruch! (nahtlos) ✅
```

### 📊 **Queue State Transitions**

```
User Adds Videos:
  /watch "A" → isPlaying=false
    → add(A), play(A)
    → Queue: [A*], isPlaying=true
    → ffmpeg A läuft

  /watch "B" → isPlaying=true
    → add(B)
    → Queue: [A*, B], isPlaying=true
    → ffmpeg A läuft immer noch

  /watch "C"
    → add(C)
    → Queue: [A*, B, C], isPlaying=true

User Skips:
  /skip
    → skip()
    → currentIndex=1, getCurrent()=B
    → Queue: [A, B*, C], isPlaying=true
    → ffmpeg switch: A → B

  /skip
    → currentIndex=2, getCurrent()=C
    → Queue: [A, B, C*], isPlaying=true
    → ffmpeg switch: B → C

  /skip
    → currentIndex=3, getCurrent()=null
    → Queue: [], isPlaying=false
    → ffmpeg C killed

User Removes:
  /remove 2
    → remove(position=2) = remove upcoming[0] = B
    → Queue: [A*, C], isPlaying=true
    → A weiter spielen

  /remove 1
    → remove(position=1) = remove current = A
    → Queue: [C*], isPlaying=true
    → Trigger skip → C startet
```

### 🧪 Test Coverage nach Komponente

| Komponente | Unit | Integration | E2E |
|------------|------|-------------|-----|
| QueueManager | ✅ add, skip, remove, clear | ✅ with commands | — |
| SyncController | ✅ play, skip, onVideoEnded | ✅ lifecycle | — |
| ffmpeg.ts | ✅ arg builders | ✅ spawn | ✅ binary exists |
| yt-dlp.ts | ✅ arg builders | ✅ resolve | ✅ binary exists |
| Commands | ✅ all 8 | ✅ registration | — |
| Plugin Lifecycle | — | ✅ onLoad/onUnload | ✅ import |

---

## 📌 Wichtige Regeln (aus Agent Instructions)

### ✅ DO

- ✅ Jede Änderung mit REQ-ID verknüpfen
- ✅ Tests ZUERST schreiben (TDD)
- ✅ TypeScript strict mode
- ✅ Named exports only
- ✅ Zod für Input-Validierung
- ✅ Bun runtime (nicht Node.js!)
- ✅ ES6+ modules
- ✅ kebab-case Dateinamen

### ❌ DON'T

- ❌ Default exports
- ❌ `any` types
- ❌ `var` keyword
- ❌ CommonJS `require()`
- ❌ Code ohne Tests
- ❌ Features ohne Requirement
- ❌ Secrets im Code
- ❌ `node:` prefix

---

## 🔄 Maintenance & Documentation Updates

**Nach größeren Funktionsänderungen:**

1. **Diese Datei updaten** (CODEBASE_OVERVIEW.md)
   - Flows aktualisieren
   - Neue Methoden dokumentieren
   - Diagramme überprüfen

2. **REQUIREMENTS.md updaten**
   - Neue REQ-IDs hinzufügen

3. **Tests aktualisieren**
   - Neue Tests schreiben
   - Alte Tests fixieren

4. **Commit Message:** 
   ```
   feat(REQ-xxx): new feature description
   docs: update CODEBASE_OVERVIEW.md
   ```

---

**Version:** 2026-02-23  
**Last Updated:** Schritt 8 komplett ✅  
**Vollständig?** JA — Alle 8 Schritte dokumentiert
