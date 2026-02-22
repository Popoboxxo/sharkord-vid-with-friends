# Architektur — sharkord-vid-with-friends

## Überblick

```
┌─────────────────────────────────────────────────────────────────┐
│  Sharkord Server                                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  sharkord-vid-with-friends Plugin                         │  │
│  │                                                           │  │
│  │  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐  │  │
│  │  │ Commands  │──▶│ SyncController│──▶│  StreamManager   │  │  │
│  │  └──────────┘   │              │   │  ┌────────────┐  │  │  │
│  │                  │  ┌────────┐ │   │  │  yt-dlp    │  │  │  │
│  │  ┌──────────┐   │  │ Queue  │ │   │  │  (resolve) │  │  │  │
│  │  │ Settings │   │  │Manager │ │   │  └────────────┘  │  │  │
│  │  └──────────┘   │  └────────┘ │   │  ┌────────────┐  │  │  │
│  │                  └──────────────┘   │  │  ffmpeg    │  │  │  │
│  │  ┌──────────┐                      │  │  (stream)  │  │  │  │
│  │  │   UI     │                      │  └────────────┘  │  │  │
│  │  │Components│                      │  ┌────────────┐  │  │  │
│  │  └──────────┘                      │  │ Mediasoup  │  │  │  │
│  │                                    │  │ Transports │  │  │  │
│  │                                    │  └────────────┘  │  │  │
│  │                                    └──────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                    Mediasoup SFU (RTP)                           │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         ┌────▼────┐     ┌────▼────┐      ┌────▼────┐
         │ Client A│     │ Client B│      │ Client C│
         │ (React) │     │ (React) │      │ (React) │
         └─────────┘     └─────────┘      └─────────┘
```

## Datenfluss — Server-Side Streaming (Standard-Modus)

```
YouTube URL
    │
    ▼
  yt-dlp  ─── resolveVideo() ──▶  { streamUrl, title, duration, thumbnail }
    │
    ▼
  ffmpeg  ─── spawnVideoStream() ──▶  HLS Segments (temp directory)
    │
    ├── ffmpeg (video) ──▶ RTP H264 ──▶ Mediasoup PlainTransport ──▶ Video Producer
    │
    └── ffmpeg (audio) ──▶ RTP Opus ──▶ Mediasoup PlainTransport ──▶ Audio Producer
                                                │
                                                ▼
                                    ctx.actions.voice.createStream()
                                                │
                                                ▼
                                    Sharkord verteilt an alle Clients
                                    im Voice-Channel (WebRTC)
```

## Datenfluss — Client-Side Sync (Hybrid-Modus, REQ-014)

```
  Server (SyncController)                   Client (UI Component)
         │                                         │
         │◀── /watch <url> ──────────────────────  │
         │                                         │
         │── SYNC_PLAY { url, startAt } ─────────▶│
         │                                         │── YouTube iframe Player
         │── SYNC_PAUSE { position } ────────────▶│      ▲
         │                                         │      │
         │── SYNC_SEEK { position } ─────────────▶│──────┘
         │                                         │
         │── SYNC_HEARTBEAT { position } ────────▶│── Drift-Korrektur
```

## Komponenten

### QueueManager (`src/queue/queue-manager.ts`)
- **Verantwortung:** Verwaltet eine geordnete Liste von Videos pro Channel
- **State:** `Map<channelId, QueueItem[]>` + `currentIndex`
- **Rein funktional:** Keine Sharkord-Dependencies, voll testbar
- **Operationen:** `add`, `remove`, `skip`, `current`, `list`, `clear`, `size`
- **Events:** `onAdvance(callback)` — wird aufgerufen wenn zum nächsten Video gewechselt wird

### StreamManager (`src/stream/stream-manager.ts`)
- **Verantwortung:** Mediasoup Transport+Producer Lifecycle, ffmpeg-Prozesse
- **Abhängig von:** `PluginContext.actions.voice`, `ffmpeg.ts`, `yt-dlp.ts`
- **Pattern:** Erstellt PlainTransport für Audio + Video, spawned ffmpeg, registriert Stream via `createStream()`

### SyncController (`src/sync/sync-controller.ts`)
- **Verantwortung:** Orchestriert Queue + Stream, Auto-Advance, Pause/Resume, Modus-Wechsel
- **State pro Channel:** `{ isPlaying, isPaused, currentVideo, mode }`
- **Auto-Advance (REQ-009):** Wenn ffmpeg-Prozess endet → `queue.skip()` → nächstes Video starten

### Commands (`src/commands/*.ts`)
- **Verantwortung:** Sharkord Command-Registrierung, Input-Validierung, Delegation an SyncController
- **Pattern:** Jeder Command in eigener Datei, registriert sich über `ctx.commands.register()`

### UI Components (`src/ui/components.tsx`)
- **Verantwortung:** React-Komponenten für Plugin-Slots
- **Slots:** `TOPBAR_RIGHT` (Now Playing Badge), `HOME_SCREEN` (Queue-Übersicht)
- **Hybrid:** Wenn Client-Sync aktiv → eingebetteter YouTube iframe Player

## Entscheidungslog

| Entscheidung | Begründung |
|-------------|------------|
| HLS als Zwischenbuffer | Stabilisiert den Stream, verhindert Stutter bei Netzwerkproblemen (IPTV-Plugin-Pattern) |
| H264 + Opus Codecs | Kompatibel mit Mediasoup WebRTC, identisch zum IPTV-Plugin |
| Pro-Channel Queue | Ermöglicht parallele Watch-Parties in verschiedenen Channels |
| yt-dlp für URL-Auflösung | Bewährtes Muster aus sharkord-music-bot, unterstützt Suche + Cookies |
| Zod für Validierung | Sharkord-Konvention, bereits als Dependency verfügbar |
| Named Exports only | Sharkord Contributing Guide Vorgabe |
