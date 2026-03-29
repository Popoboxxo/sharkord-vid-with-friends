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
| `play()` fire-and-forget | Stream-Start dauert zu lang für den Command-Response-Timeout — `syncController.play()` wird nicht awaited, Fehler werden über `.catch()` abgefangen |
| Pre-filled GitHub Issue URL (tokenless) | Gist-API erfordert Token; pre-filled URL funktioniert anonym, vermeidet OAuth-Aufwand für einfache Bug-Reports |

---

## Sharkord v0.0.16 — Kompatibilitätsstatus

Diese Sektion dokumentiert den aktuellen Zielstand für Sharkord `v0.0.16` und SDK `0.0.16`.

- Dev-Docker-Stack nutzt `sharkord/sharkord:v0.0.16`
- Plugin-Dev-Abhängigkeiten referenzieren `@sharkord/plugin-sdk@0.0.16` und `@sharkord/shared@0.0.16`
- Command-Response-Vertrag bleibt `{ response: string }`
- Dokumentation und Agent-Playbooks wurden auf den Zielstand `0.0.16` angehoben

## Sharkord v0.0.15 — Breaking Changes & Migrationsnotes (Historisch)

Diese Sektion dokumentiert alle inkompatiblen Änderungen, die beim Upgrade auf Sharkord v0.0.15 aufgetreten sind.

### 1. Command Response Format

**Vorher (v0.0.14 und früher):**
```typescript
executes: async () => "Playback stopped."
```

**Nachher (v0.0.15):**
```typescript
executes: async () => ({ response: "Playback stopped." })
```

`executes()` muss `{ response: string }` zurückgeben. Ein plain String führt dazu, dass die Command-Response im Chat nicht angezeigt wird (Command-Block unsichtbar).

Betrifft alle Dateien unter `src/commands/*.ts`.

### 2. Docker Container-Pfade

**Vorher:** Sharkord lief als `root` — Konfig-Verzeichnis war `/root/.config/sharkord`.

**Nachher:** Sharkord läuft als `bun`-User — Konfig-Verzeichnis ist `/home/bun/.config/sharkord`.

Auswirkung auf `docker-compose.dev.yml` Volume-Mounts:
```yaml
# Vorher
- sharkord-data:/root/.config/sharkord
- ./dist/...:/root/.config/sharkord/plugins/...

# Nachher
- sharkord-data:/home/bun/.config/sharkord
- ./dist/...:/home/bun/.config/sharkord/plugins/...
```

### 3. Volume Mounts: `:ro` Flag entfernt

Sharkord v0.0.15 führt beim Container-Start einen `chown`-Lauf auf das Plugin-Verzeichnis durch. Read-only-Mounts (`:ro`) crashen den Container bei diesem Schritt.

**Lösung:** `:ro`-Flags auf Plugin-Verzeichnis-Mounts entfernt.

### 4. Logo-Feld in package.json

Das `logo`-Feld in der `sharkord`-Config-Sektion von `package.json` wird vom Sharkord-Frontend über `zod.url()` validiert.

**Problem:** Ein relativer Pfad wie `"logo": "logo.png"` besteht diese Validierung nicht — Sharkord macht den Command-Block für das Plugin unsichtbar.

**Lösung:** `logo`-Feld vollständig aus `package.json` entfernt. Das Logo-`png` bleibt im Build-Output für manuelle Verwendung, wird aber nicht mehr als Metadatenfeld deklariert.
