# sharkord-vid-with-friends

> **Alpha Release (v0.1.0-alpha.8)**
> This is an **early alpha release**. Most features are implemented but **many are still buggy or incomplete**.
> Expect rough edges, crashes, and unexpected behavior. This release is intended for **testing and feedback only** — not for production use.
> A complete stability refactor is planned before the first stable release.

A Sharkord plugin for watching YouTube videos together in voice channels.
Server-side streaming via **yt-dlp → ffmpeg → Mediasoup RTP** guarantees frame-accurate synchronization for all participants.

## Known Issues & Limitations (Alpha)

- **Audio/video sync** can drift during long playback sessions
- **Auto-advance** may occasionally hang between queue items
- **Pause/resume** does not always restore the stream cleanly
- **Hybrid-sync mode** (client-side YouTube player) is experimental and largely untested
- **Queue operations** (skip, remove) can produce race conditions under load
- **Error handling** is minimal — invalid URLs or network issues may cause silent failures
- **UI components** (NowPlaying badge, Queue panel) may not update in real-time
- **Volume control** changes may not take effect until the next track
- **No reconnection logic** — if the Mediasoup transport drops, a manual `/vid-stop` + replay is needed

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
| `/vid-watch <url\|query>` | Play a YouTube video (rejected if another video is already active in the same channel) |
| `/vid-queue` | Display the current video queue |
| `/vid-skip` | Skip the current video |
| `/vid-remove <position>` | Remove a video from the queue by position |
| `/vid-stop` | Stop playback and clear the queue |
| `/vid-nowplaying` | Show the currently playing video |
| `/vid-pause` | Toggle pause/resume |
| `/vid-resume` | Resume only when a video is paused |
| `/vid-volume <0-100>` | Set the playback volume |
| `/vid-debug-cache` | List debug cache files (debug mode only) |
| `/vid-bugreport [description]` | Create a pre-filled GitHub issue with anonymized debug info |

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
3. Execute commands (e.g., `/vid-watch eggs`)
4. Check Sharkord logs for `[DEBUG]` prefixed messages

**Example Debug Output:**
```
[DEBUG] [/vid-watch] User 42 requested: eggs in channel 3
[DEBUG] [/vid-watch] Converted to search query: ytsearch:eggs
[DEBUG] [/vid-watch] Starting playback immediately for channel 3
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

- [Sharkord](https://github.com/nicanderhery/sharkord) >= 0.0.15
- **ffmpeg** and **yt-dlp** binaries (see below)

## Required Binaries

The plugin requires **ffmpeg** and **yt-dlp** as external binaries. They must be placed in the `bin/` directory inside the installed plugin folder.

```
<sharkord-plugins>/sharkord-vid-with-friends/
├── index.js          # Plugin bundle (from release)
├── package.json      # Plugin metadata (from release)
└── bin/
    ├── ffmpeg        # Linux: static binary (amd64)
    ├── ffmpeg.exe    # Windows: ffmpeg executable
    ├── yt-dlp        # Linux: standalone binary
    └── yt-dlp.exe    # Windows: yt-dlp executable
```

**The binaries are NOT included in the release.** You must provide them yourself:

| Binary | Linux | Windows | Source |
|--------|-------|---------|--------|
| **ffmpeg** | `bin/ffmpeg` | `bin/ffmpeg.exe` | [ffmpeg.org/download](https://ffmpeg.org/download.html) or [johnvansickle.com/ffmpeg](https://johnvansickle.com/ffmpeg/) (static build) |
| **yt-dlp** | `bin/yt-dlp` | `bin/yt-dlp.exe` | [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases/latest) |

> **Tip:** When using the Docker development setup (`docker-compose.dev.yml`), binaries are downloaded automatically by the `init-binaries` service.

## Installation

### From Release (recommended)

1. Download `sharkord-vid-with-friends.zip` from the [latest release](https://github.com/Popoboxxo/sharkord-vid-with-friends/releases)
2. Extract into your Sharkord plugins directory:
   ```bash
   # Linux/macOS
   unzip sharkord-vid-with-friends.zip -d ~/.config/sharkord/plugins/sharkord-vid-with-friends

   # Windows
   # Extract to %APPDATA%\sharkord\plugins\sharkord-vid-with-friends
   ```
3. Place ffmpeg and yt-dlp binaries in the `bin/` folder (see above)
4. Restart Sharkord

### From Source

```bash
# Clone the repository
git clone https://github.com/Popoboxxo/sharkord-vid-with-friends.git
cd sharkord-vid-with-friends

# Install dependencies
bun install

# Build the plugin
bun run build

# Copy dist output to Sharkord plugins directory
cp -r dist/sharkord-vid-with-friends ~/.config/sharkord/plugins/

# Place ffmpeg & yt-dlp binaries in the plugin's bin/ directory
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

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the full requirements catalog (REQ-001 through REQ-041).

