# sharkord-vid-with-friends

> **⚠️ Project Status:** This is a **95% "Vibe Coded" prototype** created for rapid development and feature exploration.  
> Before production deployment, **a complete refactor is required** for stability, error handling, and code quality improvements.

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
| `/watch <url\|query>` | Play a YouTube video (rejected if another video is already active in the same channel) |
| `/queue` | Display the current video queue |
| `/skip` | Skip the current video |
| `/remove <position>` | Remove a video from the queue by position |
| `/watch_stop` | Stop playback and clear the queue |
| `/nowplaying` | Show the currently playing video |
| `/pause` | Toggle pause/resume |
| `/resume` | Resume only when a video is paused |
| `/volume <0-100>` | Set the playback volume |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Sync Mode** | Select | `server` | How videos are synchronized: Server-Side (RTP) or Client-Side (YouTube Player) |
| **Video Bitrate** | Number | `3000` | Video bitrate (kbps) for RTP streaming (e.g., 3000, 4000) |
| **Audio Bitrate** | Number | `128` | Audio bitrate (kbps) for RTP streaming (e.g., 128, 192) |
| **Default Volume** | Number | `75` | Default playback volume (0-100) |
| **Full Download Mode** | Boolean | `false` | If enabled, wait for full video download before playback; if disabled, play during download |
| **Debug Mode** | Boolean | `false` | Enable detailed logging for debugging stream lifecycle, ffmpeg, and yt-dlp (REQ-026) |

### Debug Mode (REQ-026)

When enabled, the plugin outputs detailed logs for:
- Video resolution (yt-dlp queries and results)
- Stream lifecycle (start, stop, auto-advance)
- FFmpeg commands and exit codes
- RTP transport setup (ports, SSRCs)
- Queue operations (add, skip, remove)
- User actions (play, pause, volume changes)

**Usage:**
1. Enable in plugin settings: `Debug Mode` → `true`
2. Restart the voice channel or plugin
3. Execute commands (e.g., `/watch eggs`)
4. Check Sharkord logs for `[DEBUG]` prefixed messages

**Example Debug Output:**
```
[DEBUG] [/watch] User 42 requested: eggs in channel 3
[DEBUG] [/watch] Converted to search query: ytsearch:eggs
[DEBUG] [/watch] Starting playback immediately for channel 3
[DEBUG:stream:3] [RTP Setup] Video: rtp://127.0.0.1:56802
[DEBUG:stream:3] [RTP Setup] Audio: rtp://127.0.0.1:49369
[DEBUG:stream:3] [FFmpeg Command] /path/to/ffmpeg -hide_banner ...
```

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
├── commands/              # All slash commands (including /resume)
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

# Cross-platform session bootstrap (Linux/Windows)
bun run dev:stack

# Reload Sharkord service after plugin changes
bun run dev:reload

# Fresh stack reset (down --volumes + up)
bun run dev:stack:fresh
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
