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

import { buildVideoStreamArgs, buildAudioStreamArgs, spawnFfmpeg, killProcess } from "./stream/ffmpeg";
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

    // 1. Clean up any existing stream in this channel
    streamManager.cleanup(channelId);
    debugLog(ctx, `[startStream]`, `Cleaned up old stream resources`);

    // 2. Get Mediasoup router and listen info
    const router = ctx.actions.voice.getRouter(channelId);
    const { ip, announcedAddress } = await ctx.actions.voice.getListenInfo();
    debugLog(ctx, `[startStream]`, `Mediasoup listen: ${ip} (announced: ${announcedAddress || 'none'})`);

    // 3. Create transports + producers
    const transports = await streamManager.createTransports(
      router as never,
      ip,
      announcedAddress
    );
    debugLog(ctx, `[startStream]`, `Created transports - Video port: ${transports.videoTransport.tuple.localPort}, Audio port: ${transports.audioTransport.tuple.localPort}`);

    const producers = await streamManager.createProducers(transports);
    debugLog(ctx, `[startStream]`, `Created producers with SSRCs - Video: ${transports.videoSsrc}, Audio: ${transports.audioSsrc}`);

    // 4. Register stream with Sharkord
    const streamHandle = ctx.actions.voice.createStream({
      channelId,
      key: STREAM_KEY,
      title: item.title,
      avatarUrl: PLUGIN_AVATAR_URL,
      producers: {
        audio: producers.audioProducer,
        video: producers.videoProducer,
      },
    });

    // 5. Get volume setting
    const volume = syncController.getVolume(channelId) / 100;

    // REQ-026: If Mediasoup listens on 0.0.0.0, ffmpeg must send to 127.0.0.1
    const rtpHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;
    debugLog(ctx, `[startStream]`, `RTP destination: ${rtpHost} (listen IP: ${ip})`);

    // 6. Spawn video RTP streamer (reads directly from stream URL)
    const videoArgs = buildVideoStreamArgs({
      sourceUrl: item.streamUrl,
      rtpHost,
      rtpPort: transports.videoTransport.tuple.localPort,
      payloadType: VIDEO_CODEC.payloadType,
      ssrc: transports.videoSsrc,
      bitrate: DEFAULT_SETTINGS.BITRATE_VIDEO,
    });

    loggers.debug(`[RTP Setup] Video: rtp://${rtpHost}:${transports.videoTransport.tuple.localPort}`);
    const videoProcess = spawnFfmpeg(videoArgs, loggers, item.streamUrl, item.youtubeUrl, "video");

    // 7. Spawn audio RTP streamer (reads from separate audio URL if available)
    const audioArgs = buildAudioStreamArgs({
      sourceUrl: item.audioUrl,  // Use separate audio URL resolved by yt-dlp
      rtpHost,
      rtpPort: transports.audioTransport.tuple.localPort,
      payloadType: AUDIO_CODEC.payloadType,
      ssrc: transports.audioSsrc,
      bitrate: DEFAULT_SETTINGS.BITRATE_AUDIO,
      volume,
    });

    loggers.debug(`[RTP Setup] Audio: rtp://${rtpHost}:${transports.audioTransport.tuple.localPort}`);
    const audioProcess = spawnFfmpeg(audioArgs, loggers, item.audioUrl, item.youtubeUrl, "audio");

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

    // 9. Monitor video process exit for auto-advance (REQ-009)
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
