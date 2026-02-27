/**
 * Plugin entry point — sharkord-vid-with-friends.
 *
 * Exports: onLoad, onUnload, components
 * Initializes QueueManager, StreamManager, SyncController,
 * registers all commands, wires up event listeners.
 *
 * Referenced by: REQ-014, REQ-015, REQ-016, REQ-017, REQ-018
 */
import { QueueManager } from "./queue/queue-manager";
import { StreamManager } from "./stream/stream-manager";
import type { ChannelStreamResources, StreamHandleLike } from "./stream/stream-manager";
import { SyncController } from "./sync/sync-controller";
import type { QueueItem } from "./queue/types";

import { spawnFfmpeg } from "./stream/ffmpeg";
import type { FfmpegLoggers, SpawnedProcess } from "./stream/ffmpeg";

import * as path from "path";

import {
  STREAM_KEY,
  PLUGIN_NAME,
  PLUGIN_AVATAR_URL,
  DEFAULT_SETTINGS,
  AUDIO_CODEC,
  VIDEO_CODEC,
} from "./utils/constants";

import { registerPlayCommand } from "./commands/play";
import { registerQueueCommand } from "./commands/queue";
import { registerSkipCommand } from "./commands/skip";
import { registerRemoveCommand } from "./commands/remove";
import { registerStopCommand } from "./commands/stop";
import { registerNowPlayingCommand } from "./commands/nowplaying";
import { registerPauseCommand } from "./commands/pause";
import { registerVolumeCommand } from "./commands/volume";
import { registerDebugCacheCommand } from "./commands/debug_cache";

import { mkdirSync } from "fs";

// ---- Plugin-level singletons (initialized in onLoad) ----

let queueManager: QueueManager;
let streamManager: StreamManager;
let syncController: SyncController;

// ---- Debug Mode Helper (REQ-026) ----

/**
 * Log debug messages only if debug mode is enabled.
 * Requires a PluginContext with settings access.
 * Used only in startStream where we have direct ctx access.
 */
const debugLog = (ctx: PluginContext, prefix: string, ...messages: unknown[]): void => {
  try {
    // Safe access - settings might not be available in all contexts
    if (!ctx.settings?.get) {
      return;
    }
    const debugMode = ctx.settings.get<boolean>("debugMode") ?? false;
    if (debugMode) {
      ctx.log(`[DEBUG] ${prefix}`, ...messages);
    }
  } catch {
    // Silently fail if settings not available
  }
};

// ---- Types ----

/**
 * Minimal PluginContext shape for the plugin entry point.
 * The real PluginContext comes from @sharkord/plugin-sdk at runtime.
 */
type PluginContext = {
  log: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  commands: {
    register: <TArgs = void>(command: {
      name: string;
      description?: string;
      args?: { name: string; description?: string; type: string; required?: boolean }[];
      executes: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
  events: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  settings: {
    register: (definitions: unknown) => void;
    get: <T = unknown>(key: string) => T | undefined;
  };
  actions: {
    voice: {
      getRouter: (channelId: number) => unknown;
      getListenInfo: () => Promise<{ ip: string; announcedAddress?: string }>;
      createStream: (options: {
        channelId: number;
        key: string;
        title: string;
        avatarUrl?: string;
        producers: { audio: unknown; video: unknown };
      }) => StreamHandleLike;
    };
  };
  ui: {
    registerComponents: (components: unknown) => void;
  };
};

// ---- Streaming orchestration ----

/**
 * Start a full video+audio stream for a channel. (REQ-002, REQ-003)
 *
 * Pipeline: yt-dlp resolved URL → ffmpeg (HLS buffer) → ffmpeg (video RTP) + ffmpeg (audio RTP) → Mediasoup
 */
const startStream = async (
  ctx: PluginContext,
  channelId: number,
  item: QueueItem
): Promise<void> => {
  try {
    const debugMode = ctx.settings?.get ? (ctx.settings.get<boolean>("debugMode") ?? false) : false;
    const loggers: FfmpegLoggers = {
      log: (...m) => ctx.log(`[stream:${channelId}]`, ...m),
      error: (...m) => ctx.error(`[stream:${channelId}]`, ...m),
      debug: (...m) => {
        if (debugMode) {
          ctx.log(`[DEBUG:stream:${channelId}]`, ...m);
        } else {
          ctx.debug(`[stream:${channelId}]`, ...m);
        }
      },
    };

    ctx.log(`[stream:${channelId}] Starting RTP stream: ${item.title}`);

    // 1. Clean up any existing stream in this channel
    streamManager.cleanup(channelId);

    // 2. Get Mediasoup router and listen info
    const router = ctx.actions.voice.getRouter(channelId) as unknown;
    const { ip, announcedAddress } = await ctx.actions.voice.getListenInfo();

    if (!router) {
      throw new Error(`No Mediasoup router available for channel ${channelId}`);
    }

    // 3. Create Mediasoup transports for video and audio (PlainTransport for RTP)
    const transportOptions = {
      listenIp: { ip, announcedIp: announcedAddress },
      rtcpMux: true,
      comedia: true,
      enableSrtp: false,
    };

    ctx.debug(`[stream:${channelId}] Creating Mediasoup transports on ${ip}...`);

    const audioTransport = (await (router as any).createPlainTransport(transportOptions)) as any;
    const videoTransport = (await (router as any).createPlainTransport(transportOptions)) as any;

    ctx.log(`[stream:${channelId}] Audio transport created (port ${(audioTransport as any).tuple?.localPort})`);
    ctx.log(`[stream:${channelId}] Video transport created (port ${(videoTransport as any).tuple?.localPort})`);

    // 4. Create producers on the transports
    const audioProducer = (await audioTransport.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [
          {
            mimeType: "audio/opus",
            payloadType: 111,
            clockRate: 48000,
            channels: 2,
            parameters: {
              minptime: 10,
              useinbandfec: 1,
            },
            rtcpFeedback: [],
          },
        ],
        encodings: [{ ssrc: Math.floor(Math.random() * 1_000_000_000) + 1 }],
      },
    })) as any;

    const videoProducer = (await videoTransport.produce({
      kind: "video",
      rtpParameters: {
        codecs: [
          {
            mimeType: "video/vp8",
            payloadType: 96,
            clockRate: 90000,
            parameters: {},
            rtcpFeedback: [
              { type: "nack" },
              { type: "nack", parameter: "pli" },
              { type: "ccm", parameter: "fir" },
            ],
          },
        ],
        encodings: [{ ssrc: Math.floor(Math.random() * 1_000_000_000) + 1 }],
      },
    })) as any;

    ctx.log(`[stream:${channelId}] Audio producer created (SSRC: ${(audioProducer as any).rtpParameters?.encodings?.[0]?.ssrc})`);
    ctx.log(`[stream:${channelId}] Video producer created (SSRC: ${(videoProducer as any).rtpParameters?.encodings?.[0]?.ssrc})`);

    // 5. Get volume setting
    const volume = syncController.getVolume(channelId);  // Already 0-100

    // 6. Spawn ffmpeg with RTP output (using temp-file method for stability)
    const ffmpegVideoProc = await spawnFfmpeg({
      streamType: "video",
      sourceUrl: item.streamUrl,
      youtubeUrl: item.youtubeUrl,
      rtpHost: ip,
      rtpPort: (videoTransport as any).tuple?.localPort,
      payloadType: 96,
      ssrc: (videoProducer as any).rtpParameters?.encodings?.[0]?.ssrc || 1,
      bitrate: DEFAULT_SETTINGS.BITRATE_VIDEO,
      debugEnabled: debugMode,
      waitForDownloadComplete: true,
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Video ffmpeg ended`);
      },
    });

    const ffmpegAudioProc = await spawnFfmpeg({
      streamType: "audio",
      sourceUrl: item.audioUrl,
      youtubeUrl: item.youtubeUrl,
      rtpHost: ip,
      rtpPort: (audioTransport as any).tuple?.localPort,
      payloadType: 111,
      ssrc: (audioProducer as any).rtpParameters?.encodings?.[0]?.ssrc || 1,
      bitrate: DEFAULT_SETTINGS.BITRATE_AUDIO,
      volume,
      debugEnabled: debugMode,
      waitForDownloadComplete: false,  // Audio can start even if download isn't complete
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Audio ffmpeg ended, checking auto-advance`);
        try {
          await syncController.onVideoEnded(channelId);
        } catch (e) {
          ctx.error(`[stream:${channelId}] Error handling process exit:`, e);
        }
      },
    });

    ctx.log(`[stream:${channelId}] ffmpeg spawned (video PID: ${ffmpegVideoProc.process.pid}, audio PID: ${ffmpegAudioProc.process.pid})`);

    // 7. Register stream with Sharkord using real Mediasoup producers
    const streamHandle = ctx.actions.voice.createStream({
      channelId,
      key: STREAM_KEY,
      title: item.title,
      avatarUrl: PLUGIN_AVATAR_URL,
      producers: { audio: audioProducer, video: videoProducer },
    });

    ctx.log(`[stream:${channelId}] 🎬 Stream registered with Sharkord`);

    // 8. Store stream resources
    const resources: ChannelStreamResources = {
      audioTransport,
      videoTransport,
      audioProducer,
      videoProducer,
      videoProcess: ffmpegVideoProc,
      audioProcess: ffmpegAudioProc,
      streamHandle,
      router: router as any,  // Runtime type is Mediasoup Router
    };

    streamManager.setActive(channelId, resources);

    // 9. Monitor ffmpeg processes for auto-advance (REQ-009)
    monitorProcess(ctx, channelId, ffmpegVideoProc);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    ctx.error(`[startStream] FATAL ERROR for channel ${channelId}:`, errorMsg);

    // Cleanup on error
    streamManager.cleanup(channelId);
    syncController.stop(channelId);

    throw new Error(`Stream startup failed: ${errorMsg}`);
  }
};

/**
 * Monitor Mediasoup producer score events for RTP delivery diagnostics. (REQ-026)
 * Logs when producer score changes — indicates RTP packets are arriving.
 * Also updates stream title from preparation → actual title on first video RTP. (REQ-028-B)
 */
const monitorProducers = (
  ctx: PluginContext,
  channelId: number,
  videoProducer: unknown,
  audioProducer: unknown,
  streamHandle?: StreamHandleLike,
  videoTitle?: string
): void => {
  // Access the real Mediasoup observer (runtime type, bypasses our minimal interface)
  const vp = videoProducer as { observer?: { on: (e: string, h: (...a: unknown[]) => void) => void } };
  const ap = audioProducer as { observer?: { on: (e: string, h: (...a: unknown[]) => void) => void } };

  let titleUpdated = false;

  try {
    vp.observer?.on("score", (score: unknown) => {
      ctx.log(`[stream:${channelId}] [Video Producer] Score update:`, JSON.stringify(score));
      // REQ-028-B: Update stream title from "⏳ Wird vorbereitet…" to actual title
      if (!titleUpdated && streamHandle && videoTitle) {
        titleUpdated = true;
        try {
          streamHandle.update({ title: videoTitle });
          ctx.log(`[stream:${channelId}] Stream title updated to: ${videoTitle}`);
        } catch {
          ctx.debug(`[stream:${channelId}] Could not update stream title`);
        }
      }
    });
    vp.observer?.on("close", () => {
      ctx.log(`[stream:${channelId}] [Video Producer] Closed`);
    });
  } catch {
    ctx.debug(`[stream:${channelId}] Could not attach video producer observer`);
  }

  try {
    ap.observer?.on("score", (score: unknown) => {
      ctx.log(`[stream:${channelId}] [Audio Producer] Score update:`, JSON.stringify(score));
    });
    ap.observer?.on("close", () => {
      ctx.log(`[stream:${channelId}] [Audio Producer] Closed`);
    });
  } catch {
    ctx.debug(`[stream:${channelId}] Could not attach audio producer observer`);
  }

  // REQ-028-B: Fallback — update title after 8 seconds even if no score event
  setTimeout(() => {
    if (!titleUpdated && streamHandle && videoTitle) {
      titleUpdated = true;
      try {
        streamHandle.update({ title: videoTitle });
        ctx.debug(`[stream:${channelId}] Title updated via fallback timer`);
      } catch { /* ignore */ }
    }
  }, 8000);
};

/**
 * Schedule a stream health check after a delay. (REQ-026)
 * Verifies that RTP data is actually flowing from ffmpeg → Mediasoup.
 * Uses producer.getStats() to check byte/packet counts.
 */
const scheduleHealthCheck = (
  ctx: PluginContext,
  channelId: number,
  videoProducer: unknown,
  audioProducer: unknown
): void => {
  setTimeout(async () => {
    if (!streamManager.isActive(channelId)) {
      ctx.debug(`[health:${channelId}] Stream no longer active, skipping check`);
      return;
    }

    ctx.log(`[health:${channelId}] === Stream Health Check (5s after start) ===`);

    // Check producer stats via Mediasoup getStats()
    const vp = videoProducer as { getStats?: () => Promise<unknown[]>; closed?: boolean; paused?: boolean; score?: unknown };
    const ap = audioProducer as { getStats?: () => Promise<unknown[]>; closed?: boolean; paused?: boolean; score?: unknown };

    // Video producer diagnostics
    try {
      ctx.log(`[health:${channelId}] Video Producer: closed=${vp.closed}, paused=${vp.paused}, score=${JSON.stringify(vp.score)}`);
      if (vp.getStats) {
        const stats = await vp.getStats();
        if (stats && stats.length > 0) {
          const stat = stats[0] as Record<string, unknown>;
          const byteCount = stat["byteCount"] ?? stat["bytesReceived"] ?? "unknown";
          const packetCount = stat["packetCount"] ?? stat["packetsReceived"] ?? "unknown";
          const jitter = stat["jitter"] ?? "unknown";
          ctx.log(`[health:${channelId}] Video RTP Stats: bytes=${byteCount}, packets=${packetCount}, jitter=${jitter}`);
          if (byteCount === 0 || packetCount === 0) {
            ctx.error(`[health:${channelId}] ⚠ NO VIDEO RTP DATA RECEIVED! ffmpeg may not be sending to the correct port.`);
          } else {
            ctx.log(`[health:${channelId}] ✓ Video RTP data flowing`);
          }
        } else {
          ctx.error(`[health:${channelId}] ⚠ Video producer getStats() returned empty — no RTP received`);
        }
      } else {
        ctx.debug(`[health:${channelId}] Video producer has no getStats() method`);
      }
    } catch (err) {
      ctx.error(`[health:${channelId}] Video health check error:`, err);
    }

    // Audio producer diagnostics
    try {
      ctx.log(`[health:${channelId}] Audio Producer: closed=${ap.closed}, paused=${ap.paused}, score=${JSON.stringify(ap.score)}`);
      if (ap.getStats) {
        const stats = await ap.getStats();
        if (stats && stats.length > 0) {
          const stat = stats[0] as Record<string, unknown>;
          const byteCount = stat["byteCount"] ?? stat["bytesReceived"] ?? "unknown";
          const packetCount = stat["packetCount"] ?? stat["packetsReceived"] ?? "unknown";
          ctx.log(`[health:${channelId}] Audio RTP Stats: bytes=${byteCount}, packets=${packetCount}`);
          if (byteCount === 0 || packetCount === 0) {
            ctx.error(`[health:${channelId}] ⚠ NO AUDIO RTP DATA RECEIVED!`);
          } else {
            ctx.log(`[health:${channelId}] ✓ Audio RTP data flowing`);
          }
        } else {
          ctx.error(`[health:${channelId}] ⚠ Audio producer getStats() returned empty — no RTP received`);
        }
      } else {
        ctx.debug(`[health:${channelId}] Audio producer has no getStats() method`);
      }
    } catch (err) {
      ctx.error(`[health:${channelId}] Audio health check error:`, err);
    }

    // Check ffmpeg processes
    const resources = streamManager.getResources(channelId);
    if (resources) {
      const vpExitCode = resources.videoProcess?.process?.exitCode;
      const apExitCode = resources.audioProcess?.process?.exitCode;
      ctx.log(`[health:${channelId}] ffmpeg Video: ${vpExitCode === null ? 'RUNNING' : `EXITED (code ${vpExitCode})`}`);
      ctx.log(`[health:${channelId}] ffmpeg Audio: ${apExitCode === null ? 'RUNNING' : `EXITED (code ${apExitCode})`}`);
    }

    ctx.log(`[health:${channelId}] === End Health Check ===`);
  }, 5000);
};

/**
 * Watch a ffmpeg process and trigger auto-advance when it exits. (REQ-009)
 */
const monitorProcess = (
  ctx: PluginContext,
  channelId: number,
  ffmpegProcess: SpawnedProcess
): void => {
  const bunProcess = ffmpegProcess.process;

  // Bun.spawn returns a Subprocess with an `.exited` Promise
  bunProcess.exited
    .then(async () => {
      ctx.debug(`[stream:${channelId}] ffmpeg process exited, checking auto-advance`);

      // Cleanup the current stream resources
      streamManager.cleanup(channelId);

      // Trigger auto-advance through SyncController
      await syncController.onVideoEnded(channelId);
    })
    .catch((err: unknown) => {
      ctx.error(`[stream:${channelId}] ffmpeg process error:`, err);
    });
};

/**
 * Monitor HLS ffmpeg process for auto-advance (REQ-009, HLS variant)
 * Similar to monitorProcess but for HLS streaming
 */
const monitorProcessForAutoAdvance = (
  ctx: PluginContext,
  channelId: number,
  bunProcess: ReturnType<typeof Bun.spawn>
): void => {
  bunProcess.exited
    .then(async () => {
      ctx.log(`[stream:${channelId}] HLS ffmpeg process exited, checking auto-advance`);

      // Cleanup the current stream resources (including HLS server)
      streamManager.cleanup(channelId);

      // Trigger auto-advance through SyncController
      try {
        await syncController.onVideoEnded(channelId);
      } catch (err) {
        ctx.error(`[stream:${channelId}] Error during auto-advance:`, err);
      }
    })
    .catch((err: unknown) => {
      ctx.error(`[stream:${channelId}] HLS ffmpeg process error:`, err);
    });
};

// ---- Event handlers ----

/**
 * Handle voice:runtime_closed — clean up ALL resources for that channel. (REQ-016)
 */
const handleVoiceRuntimeClosed = (ctx: PluginContext) => {
  return (...args: unknown[]) => {
    const event = args[0] as { channelId?: number } | undefined;
    const channelId = event?.channelId;

    if (!channelId) {
      ctx.debug("[lifecycle] voice:runtime_closed fired without channelId");
      return;
    }

    ctx.log(`[lifecycle] Voice runtime closed for channel ${channelId}, cleaning up...`);

    // Stop stream + ffmpeg processes
    streamManager.cleanup(channelId);

    // Clear sync state
    syncController.cleanupChannel(channelId);

    // Clear queue
    queueManager.clear(channelId);
  };
};

// ---- Plugin lifecycle ----

/**
 * Called when the plugin is loaded by Sharkord. (REQ-014, REQ-015)
 * Initializes all managers, registers commands, settings, and event listeners.
 */
export const onLoad = async (ctx: PluginContext): Promise<void> => {
  ctx.log(`[${PLUGIN_NAME}] Loading...`);

  // 1. Initialize core managers
  queueManager = new QueueManager();
  streamManager = new StreamManager();

  // 2. Create SyncController with the startStream callback
  syncController = new SyncController(
    queueManager,
    async (channelId: number, item: QueueItem) => {
      await startStream(ctx, channelId, item);
    }
  );

  // 3. Register settings (REQ-018, REQ-018-A through REQ-018-H)
  ctx.settings.register([
    {
      key: "videoBitrate",
      name: "Video-Bitrate (kbps)",
      type: "string",
      description:
        "Controlls video quality and file size for RTP streaming. Higher values = better quality, more bandwidth needed. " +
        "Recommended: 2500–4000 kbps for standard, 4000–6000 kbps for HD. " +
        "Range: 1000–12000 kbps. " +
        "Example: 3000, 4000, 6000. " +
        "[REQ-018-A]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_VIDEO,
    },
    {
      key: "audioBitrate",
      name: "Audio-Bitrate (kbps)",
      type: "string",
      description:
        "Controlls audio quality for RTP streaming. 128 kbps is standard quality for most users, 192+ kbps for high-fidelity audio. " +
        "Recommended: 128 kbps (standard), 192 kbps (high quality). " +
        "Range: 64–320 kbps. " +
        "Example: 128, 192. " +
        "[REQ-018-B]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_AUDIO,
    },
    {
      key: "defaultVolume",
      name: "Standard-Lautstärke (%)",
      type: "number",
      description:
        "Default playback volume when a new video starts. Applied to all channel participants. " +
        "Recommended: 75% — loud enough but not overwhelming. " +
        "Range: 0–100%. " +
        "[REQ-018-C]",
      defaultValue: DEFAULT_SETTINGS.DEFAULT_VOLUME,
      min: 0,
      max: 100,
    },
    {
      key: "syncMode",
      name: "Synchronisierungs-Modus",
      type: "select",
      description:
        "Server-Streaming: Video streamed from server via RTP. Highest quality and reliability. Recommended for most use cases. " +
        "Client-Sync: All clients play the local YouTube video with server-coordinated sync. Requires direct YouTube access on client. " +
        "[REQ-018-D]",
      defaultValue: DEFAULT_SETTINGS.SYNC_MODE,
      options: [
        { label: "Server-Streaming (Standard)", value: "server" },
        { label: "Client-Sync (Hybrid/YouTube Player)", value: "client" },
      ],
    },
    {
      key: "debugMode",
      name: "Debug-Ausgabe aktivieren",
      type: "boolean",
      description:
        "Enables detailed logging for debugging: stream lifecycle, ffmpeg stderr, yt-dlp calls, error diagnostics. " +
        "⚠️ WARNING: May affect server performance. Use only for troubleshooting. " +
        "[REQ-026, REQ-018 (Debug option)]",
      defaultValue: false,
    },
  ]);

  // 4. Register all commands (REQ-001, REQ-004-013)
  registerPlayCommand(ctx as never, queueManager, syncController);
  registerQueueCommand(ctx as never, queueManager);
  registerSkipCommand(ctx as never, syncController);
  registerRemoveCommand(ctx as never, queueManager);
  registerStopCommand(ctx as never, syncController);
  registerNowPlayingCommand(ctx as never, queueManager);
  registerPauseCommand(ctx as never, syncController);
  registerVolumeCommand(ctx as never, syncController);
  registerDebugCacheCommand(ctx as never);

  // 5. Listen for voice channel close events (REQ-016)
  ctx.events.on("voice:runtime_closed", handleVoiceRuntimeClosed(ctx));

  ctx.log(`[${PLUGIN_NAME}] Loaded successfully.`);
};

/**
 * Called when the plugin is unloaded by Sharkord. (REQ-016)
 * Cleans up all active streams, queues, and event listeners.
 */
export const onUnload = (ctx: PluginContext): void => {
  ctx.log(`[${PLUGIN_NAME}] Unloading...`);

  // Clean up all active streams (kills ffmpeg, closes transports/producers)
  streamManager.cleanupAll();

  // Clean up all sync state
  syncController.cleanupAll();

  ctx.log(`[${PLUGIN_NAME}] Unloaded.`);
};

/**
 * UI components map — registered in plugin slots. (REQ-017)
 * Provided by src/ui/components.tsx
 */
export { components } from "./ui/components";
