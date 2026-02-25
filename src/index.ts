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

import path from "path";

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
    // Safe settings access - might not be available in callback context
    const debugMode = ctx.settings?.get ? (ctx.settings.get<boolean>("debugMode") ?? false) : false;
    
    // REQ-032: Cache is ALWAYS enabled (independent of debugMode setting)
    // This allows download verification via /debug_cache even with debug output disabled
    const cacheEnabled = true;
    
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

    debugLog(ctx, `[startStream]`, `Starting stream for channel ${channelId}, video: ${item.title}`);

    // PRE-FLIGHT CHECKS (REQ-026)
    const urlLengthLimit = 2048;  // Typical buffer for statically-compiled ffmpeg
    if (item.streamUrl.length > urlLengthLimit) {
      loggers.error(`[Pre-flight] Video URL exceeds ${urlLengthLimit} chars (${item.streamUrl.length})`);
      loggers.error(`[Pre-flight] This may cause segfault in statically-compiled ffmpeg builds`);
    }
    if (item.audioUrl.length > urlLengthLimit) {
      loggers.error(`[Pre-flight] Audio URL exceeds ${urlLengthLimit} chars (${item.audioUrl.length})`);
      loggers.error(`[Pre-flight] This may cause segfault in statically-compiled ffmpeg builds`);
    }

    // 1. Clean up any existing stream in this channel
    streamManager.cleanup(channelId);
    debugLog(ctx, `[startStream]`, `Cleaned up old stream resources`);

    // 2. Get Mediasoup router and listen info
    const router = ctx.actions.voice.getRouter(channelId);
    const { ip, announcedAddress } = await ctx.actions.voice.getListenInfo();
    debugLog(ctx, `[startStream]`, `Mediasoup listen: ${ip} (announced: ${announcedAddress || 'none'})`);

    // === DIAGNOSTIC: Log Router RTP Capabilities ===
    try {
      const routerAny = router as Record<string, unknown>;
      const rtpCaps = routerAny.rtpCapabilities as { codecs?: unknown[] } | undefined;
      if (rtpCaps?.codecs) {
        ctx.log(`[stream:${channelId}] [Router Capabilities] ${rtpCaps.codecs.length} codecs supported:`);
        for (const codec of rtpCaps.codecs) {
          const c = codec as Record<string, unknown>;
          ctx.log(`[stream:${channelId}] [Router Codec] ${c.mimeType} PT=${c.preferredPayloadType} clock=${c.clockRate} params=${JSON.stringify(c.parameters)}`);
        }
      } else {
        ctx.log(`[stream:${channelId}] [Router] No rtpCapabilities found (keys: ${Object.keys(routerAny).join(", ")})`);
      }
    } catch (err) {
      ctx.debug(`[stream:${channelId}] [Router] Could not read capabilities: ${err}`);
    }
    // 3. Create transports + producers
    const transports = await streamManager.createTransports(
      router as never,
      ip,
      announcedAddress
    );
    debugLog(ctx, `[startStream]`, `Created transports - Video port: ${transports.videoTransport.tuple.localPort}, Audio port: ${transports.audioTransport.tuple.localPort}`);

    const producers = await streamManager.createProducers(
      transports
    );
    debugLog(ctx, `[startStream]`, `Created producers with SSRCs - Video: ${transports.videoSsrc}, Audio: ${transports.audioSsrc}`);

    // === DIAGNOSTIC: Log Producer details ===
    try {
      const vp = producers.videoProducer as Record<string, unknown>;
      const ap = producers.audioProducer as Record<string, unknown>;
      ctx.log(`[stream:${channelId}] [Video Producer] id=${vp.id}, kind=${vp.kind}, type=${vp.type}, paused=${vp.paused}`);
      ctx.log(`[stream:${channelId}] [Audio Producer] id=${ap.id}, kind=${ap.kind}, type=${ap.type}, paused=${ap.paused}`);
      
      // Log the Producer's actual rtpParameters (what Mediasoup accepted)
      if (vp.rtpParameters) {
        ctx.log(`[stream:${channelId}] [Video Producer RTP] ${JSON.stringify(vp.rtpParameters)}`);
      }
      if (ap.rtpParameters) {
        ctx.log(`[stream:${channelId}] [Audio Producer RTP] ${JSON.stringify(ap.rtpParameters)}`);
      }
    } catch (err) {
      ctx.debug(`[stream:${channelId}] Could not log producer details: ${err}`);
    }

    // Log Mediasoup codec configuration
    ctx.log(`[stream:${channelId}] [Mediasoup Config] Video: ${VIDEO_CODEC.mimeType}, PT=${VIDEO_CODEC.payloadType}, clock=${VIDEO_CODEC.clockRate}, SSRC=${transports.videoSsrc}`);
    ctx.log(`[stream:${channelId}] [Mediasoup Config] Audio: ${AUDIO_CODEC.mimeType}, PT=${AUDIO_CODEC.payloadType}, clock=${AUDIO_CODEC.clockRate}, ch=${AUDIO_CODEC.channels}, SSRC=${transports.audioSsrc}`);
    ctx.log(`[stream:${channelId}] [Transport] Video port=${transports.videoTransport.tuple.localPort}, Audio port=${transports.audioTransport.tuple.localPort}`);
    ctx.log(`[stream:${channelId}] [Transport] Video transport id=${transports.videoTransport.id}, Audio transport id=${transports.audioTransport.id}`);

    // 4. Register stream with Sharkord (REQ-028-B: start with preparation title)
    const streamHandle = ctx.actions.voice.createStream({
      channelId,
      key: STREAM_KEY,
      title: `⏳ Wird vorbereitet… — ${item.title}`,
      avatarUrl: PLUGIN_AVATAR_URL,
      producers: {
        audio: producers.audioProducer,
        video: producers.videoProducer,
      },
    });

    ctx.log(`[stream:${channelId}] Stream registered with preparation title`);

    // 4b. CRITICAL: Wait for client to set up consumer transport (ICE + DTLS handshake).
    // createStream() triggers onNewProducer events → client calls voice.consume → connectConsumerTransport.
    // Without this delay, ffmpeg may send the first keyframe BEFORE the consumer transport is connected,
    // causing the keyframe to be lost and resulting in a permanent black screen.
    // The 2-second delay gives the client sufficient time for the full DTLS handshake.
    ctx.log(`[stream:${channelId}] Waiting 2s for client consumer transport setup...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    ctx.log(`[stream:${channelId}] Consumer transport setup window complete, starting ffmpeg`);

    // 5. Get volume setting
    const volume = syncController.getVolume(channelId) / 100;

    // REQ-026: If Mediasoup listens on 0.0.0.0, ffmpeg must send to 127.0.0.1
    const rtpHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;
    debugLog(ctx, `[startStream]`, `RTP destination: ${rtpHost} (listen IP: ${ip})`);

    // 6+7. Spawn video & audio RTP streamers IN PARALLEL for sync
    loggers.debug(`[RTP Setup] Video: rtp://${rtpHost}:${transports.videoTransport.tuple.localPort}`);
    loggers.debug(`[RTP Setup] Audio: rtp://${rtpHost}:${transports.audioTransport.tuple.localPort}`);
    
    const [videoProcess, audioProcess] = await Promise.all([
      spawnFfmpeg({
        streamType: "video",
        sourceUrl: item.streamUrl,
        youtubeUrl: item.youtubeUrl,
        rtpHost,
        rtpPort: transports.videoTransport.tuple.localPort,
        payloadType: VIDEO_CODEC.payloadType,
        ssrc: transports.videoSsrc,
        bitrate: DEFAULT_SETTINGS.BITRATE_VIDEO,
        debugEnabled: cacheEnabled,
        loggers,
      }),
      spawnFfmpeg({
        streamType: "audio",
        sourceUrl: item.audioUrl,
        youtubeUrl: item.youtubeUrl,
        rtpHost,
        rtpPort: transports.audioTransport.tuple.localPort,
        payloadType: AUDIO_CODEC.payloadType,
        ssrc: transports.audioSsrc,
        bitrate: DEFAULT_SETTINGS.BITRATE_AUDIO,
        volume,
        debugEnabled: cacheEnabled,
        loggers,
      }),
    ]);

    // 8. Store all resources for lifecycle tracking
    const resources: ChannelStreamResources = {
      audioTransport: transports.audioTransport,
      videoTransport: transports.videoTransport,
      audioProducer: producers.audioProducer,
      videoProducer: producers.videoProducer,
      videoProcess,
      audioProcess,
      streamHandle,
      router: router as never,
    };

    streamManager.setActive(channelId, resources);

    ctx.log(`[stream:${channelId}] Streaming: ${item.title}`);

    // 9. Monitor producer scores & RTP delivery (REQ-026)
    // Also updates stream title from preparation → actual title on first RTP (REQ-028-B)
    monitorProducers(ctx, channelId, producers.videoProducer, producers.audioProducer, streamHandle, item.title);

    // 10. Schedule stream health check after 5 seconds
    scheduleHealthCheck(ctx, channelId, producers.videoProducer, producers.audioProducer);

    // 10b. REQ-028-C: Timeout warning if streaming phase not reached in 30s
    setTimeout(() => {
      if (!streamManager.isActive(channelId)) return;
      // Check if title was updated (= streaming started)
      // If still preparation title, warn
      ctx.log(`[stream:${channelId}] 30s timeout check — stream should be active by now`);
    }, 30000);

    // 11. Monitor video process exit for auto-advance (REQ-009)
    monitorProcess(ctx, channelId, videoProcess);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    ctx.error(`[startStream] FATAL ERROR for channel ${channelId}:`, errorMsg);
    if (errorStack) ctx.error(`[startStream] Stack:`, errorStack);
    
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
