# sharkord-vid-with-friends

Ein Sharkord-Plugin für gemeinsames YouTube-Schauen in Voice-Channels.  
Server-seitiges Streaming über **yt-dlp → ffmpeg → Mediasoup RTP** garantiert frame-genaue Synchronisation für alle Teilnehmer.

## Features

- **Synchronized Playback** — Alle Nutzer im Voice-Channel sehen dasselbe Video, frame-synchron
- **Video Queue** — Warteschlange pro Voice-Channel mit Add, Remove, Skip, View
- **Auto-Advance** — Nach Ende eines Videos startet automatisch das nächste
- **Volume Control** — Lautstärke pro Channel anpassbar (0–100)
- **Pause/Resume** — Stream pausieren und fortsetzen
- **Hybrid-Sync** — Server-Side RTP (primär) + optionaler Client-Side YouTube Player

## Commands

| Command | Beschreibung |
|---------|-------------|
| `/watch <url\|query>` | YouTube-Video abspielen oder zur Queue hinzufügen |
| `/queue` | Aktuelle Warteschlange anzeigen |
| `/skip` | Aktuelles Video überspringen |
| `/remove <position>` | Video an Position aus Queue entfernen |
| `/watch_stop` | Wiedergabe stoppen und Queue leeren |
| `/nowplaying` | Aktuell spielendes Video anzeigen |
| `/pause` | Pause/Fortsetzen umschalten |
| `/volume <0-100>` | Lautstärke einstellen |

## Tech-Stack

- **Runtime:** [Bun](https://bun.sh)
- **Streaming:** [Mediasoup](https://mediasoup.org/) (WebRTC SFU)
- **Video:** yt-dlp + ffmpeg (H264 Video + Opus Audio über RTP)
- **Validation:** [Zod](https://zod.dev)
- **UI:** React + Sharkord Plugin Slots
- **Testing:** bun:test + Docker

## Architektur

```
src/
├── index.ts              # Plugin-Entry: onLoad, onUnload, components
├── queue/
│   ├── queue-manager.ts  # Warteschlangen-Logik (rein funktional)
│   └── types.ts          # QueueItem, QueueState
├── stream/
│   ├── stream-manager.ts # Mediasoup Transport+Producer Lifecycle
│   ├── ffmpeg.ts         # ffmpeg HLS-Buffer + RTP Streaming
│   └── yt-dlp.ts         # YouTube URL-Auflösung
├── sync/
│   └── sync-controller.ts # Queue + Stream Orchestrierung
├── commands/              # Alle 8 Slash-Commands
├── ui/
│   └── components.tsx    # React UI für Plugin-Slots
└── utils/
    └── constants.ts      # Codec-Config, Defaults, Plugin-Konstanten
```

## Voraussetzungen

- [Bun](https://bun.sh) >= 1.3
- [Sharkord](https://github.com/nicanderhery/sharkord) >= 0.0.6
- **ffmpeg** und **yt-dlp** Binaries im `src/stream/bin/` Verzeichnis

## Installation

```bash
# Repository klonen
git clone <repo-url> ~/.config/sharkord/plugins/sharkord-vid-with-friends
cd ~/.config/sharkord/plugins/sharkord-vid-with-friends

# Dependencies installieren
bun install

# ffmpeg & yt-dlp Binaries platzieren
# Linux/macOS:
cp /usr/bin/ffmpeg src/stream/bin/ffmpeg
cp /usr/local/bin/yt-dlp src/stream/bin/yt-dlp
# Windows:
# Lege ffmpeg.exe und yt-dlp.exe in src/stream/bin/

# Plugin bauen
bun run build
```

## Development

```bash
# Alle Tests ausführen
bun test

# Nur Unit-Tests
bun run test:unit

# Nur Integration-Tests
bun run test:integration

# Docker-Tests (mit ffmpeg/yt-dlp)
docker compose -f tests/docker/docker-compose.yml up --build

# Build
bun run build
```

## Test-Driven Development

Jede Änderung folgt dem TDD-Zyklus:

1. Anforderung identifizieren (REQ-xxx aus `docs/REQUIREMENTS.md`)
2. **Test zuerst schreiben** — muss fehlschlagen
3. Minimale Implementierung bis Test grün
4. Refactoring ohne Verhaltensänderung
5. Commit: `feat(REQ-xxx): beschreibung`

### Test-Benennung

```typescript
describe("QueueManager", () => {
  it("[REQ-004] should add a video to the queue", () => { ... });
});
```

## Anforderungen

Siehe [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) für den vollständigen Anforderungskatalog (REQ-001 bis REQ-018).

## Lizenz

Privat — Sharkord Plugin
