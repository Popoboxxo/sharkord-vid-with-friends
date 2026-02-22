# sharkord-vid-with-friends

A Sharkord plugin for watching YouTube videos together in voice channels.  
Server-side streaming via **yt-dlp → ffmpeg → Mediasoup RTP** guarantees frame-accurate synchronization for all participants.

## Features

- **Synchronized Playback** — All users in a voice channel see the same video, frame-synced
- **Video Queue** — Per voice-channel queue with add, remove, skip, and view
- **Auto-Advance** — Automatically plays the next video when the current one ends
- **Volume Control** — Adjustable volume per channel (0–100)
- **Pause/Resume** — Pause and resume the stream
- **Hybrid-Sync** — Server-side RTP (primary) + optional client-side YouTube player

## Commands

| Command | Description |
|---------|-------------|
| `/watch <url\|query>` | Play a YouTube video or add it to the queue |
| `/queue` | Display the current video queue |
| `/skip` | Skip the current video |
| `/remove <position>` | Remove a video from the queue by position |
| `/watch_stop` | Stop playback and clear the queue |
| `/nowplaying` | Show the currently playing video |
| `/pause` | Toggle pause/resume |
| `/volume <0-100>` | Set the playback volume |

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Streaming:** [Mediasoup](https://mediasoup.org/) (WebRTC SFU)
- **Video:** yt-dlp + ffmpeg (H264 video + Opus audio via RTP)
- **Validation:** [Zod](https://zod.dev)
- **UI:** React + Sharkord Plugin Slots
- **Testing:** bun:test + Docker

## Architecture

```
src/
├── index.ts              # Plugin entry: onLoad, onUnload, components
├── queue/
│   ├── queue-manager.ts  # Queue logic (pure functional, no Sharkord deps)
│   └── types.ts          # QueueItem, QueueState
├── stream/
│   ├── stream-manager.ts # Mediasoup transport + producer lifecycle
│   ├── ffmpeg.ts         # ffmpeg HLS buffer + RTP streaming
│   └── yt-dlp.ts         # YouTube URL resolution
├── sync/
│   └── sync-controller.ts # Queue + stream orchestration
├── commands/              # All 8 slash commands
├── ui/
│   └── components.tsx    # React UI for plugin slots
└── utils/
    └── constants.ts      # Codec config, defaults, plugin constants
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Sharkord](https://github.com/nicanderhery/sharkord) >= 0.0.6
- **ffmpeg** and **yt-dlp** binaries in the `src/stream/bin/` directory

## Installation

```bash
# Clone the repository
git clone <repo-url> ~/.config/sharkord/plugins/sharkord-vid-with-friends
cd ~/.config/sharkord/plugins/sharkord-vid-with-friends

# Install dependencies
bun install

# Place ffmpeg & yt-dlp binaries
# Linux/macOS:
cp /usr/bin/ffmpeg src/stream/bin/ffmpeg
cp /usr/local/bin/yt-dlp src/stream/bin/yt-dlp
# Windows:
# Place ffmpeg.exe and yt-dlp.exe in src/stream/bin/

# Build the plugin
bun run build
```

## Development

```bash
# Run all tests
bun test

# Unit tests only
bun run test:unit

# Integration tests only
bun run test:integration

# Docker tests (with ffmpeg/yt-dlp)
docker compose -f tests/docker/docker-compose.yml up --build

# Build
bun run build
```

## Test-Driven Development

Every change follows the TDD cycle:

1. Identify the requirement (REQ-xxx from `docs/REQUIREMENTS.md`)
2. **Write the test first** — it must fail
3. Minimal implementation until the test passes
4. Refactor without changing behavior
5. Commit: `feat(REQ-xxx): description`

### Test Naming

```typescript
describe("QueueManager", () => {
  it("[REQ-004] should add a video to the queue", () => { ... });
});
```

## Requirements

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the full requirements catalog (REQ-001 through REQ-018).

## License

Private — Sharkord Plugin
