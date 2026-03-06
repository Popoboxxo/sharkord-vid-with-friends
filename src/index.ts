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

import { normalizeVolume, spawnFfmpeg } from "./stream/ffmpeg";
import type { FfmpegLoggers, SpawnedProcess } from "./stream/ffmpeg";

import {
  STREAM_KEY,
  PLUGIN_NAME,
  PLUGIN_AVATAR_URL,
  DEFAULT_SETTINGS,
} from "./utils/constants";

import { registerPlayCommand } from "./commands/play";
import { registerQueueCommand } from "./commands/queue";
import { registerSkipCommand } from "./commands/skip";
import { registerRemoveCommand } from "./commands/remove";
import { registerStopCommand } from "./commands/stop";
import { registerNowPlayingCommand } from "./commands/nowplaying";
import { registerPauseCommand } from "./commands/pause";
import { registerResumeCommand } from "./commands/resume";
import { registerVolumeCommand } from "./commands/volume";
import { registerDebugCacheCommand } from "./commands/debug_cache";
import { components as pluginComponents } from "./ui/components";

// ---- Plugin-level singletons (initialized in onLoad) ----

let queueManager: QueueManager;
let streamManager: StreamManager;
let syncController: SyncController;
let settingsWatcher: ReturnType<typeof setInterval> | null = null;
let settingsAccessor: { get: <T = unknown>(key: string) => T | undefined } | null = null;
let runtimeSettingsOverrides: Partial<EffectiveSettingsSnapshot> = {};
const adaptiveAudioDelayMsByChannel = new Map<number, number>();

const DEFAULT_PROGRESSIVE_AUDIO_DELAY_MS = 650;
const MIN_AUDIO_DELAY_MS = 0;
const MAX_AUDIO_DELAY_MS = 1800;
const DRIFT_ADAPT_WINDOW_SECONDS = 25;
const DRIFT_SAMPLE_MIN_COUNT = 8;
const DRIFT_ADAPT_GAIN = 0.5;
const DRIFT_PAIR_MAX_AGE_MS = 1200;
const MAX_DELAY_STEP_PER_STREAM_MS = 220;

// ---- Debug Mode Helper (REQ-026) ----

/**
 * Log debug messages only if debug mode is enabled.
 * Requires a PluginContext with settings access.
 * Used only in startStream where we have direct ctx access.
 */
const debugLog = (ctx: PluginContext, prefix: string, ...messages: unknown[]): void => {
  try {
    // Safe access with optional chaining - settings might not be available in all contexts
    const debugMode = Boolean(ctx.settings?.get?.("debugMode") ?? false);
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

type SyncMode = "server" | "client";

type EffectivePluginSettings = {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  defaultVolume: number;
  syncMode: SyncMode;
  fullDownloadMode: boolean;
  debugMode: boolean;
};

type EffectiveSettingsSnapshot = {
  videoBitrate: number;
  audioBitrate: number;
  defaultVolume: number;
  syncMode: SyncMode;
  fullDownloadMode: boolean;
  debugMode: boolean;
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const parseBooleanSetting = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
};

const getSettingValue = <T = unknown>(ctx: PluginContext, key: string): T | undefined => {
  try {
    if (settingsAccessor?.get) {
      const value = settingsAccessor.get<T>(key);
      if (value !== undefined) return value;
    }
  } catch {
    // ignore accessor read failure and fallback to ctx.settings.get
  }

  return ctx.settings?.get?.<T>(key);
};

const extractRuntimeSettingOverrides = (eventPayload: unknown): Partial<EffectiveSettingsSnapshot> => {
  if (!eventPayload || typeof eventPayload !== "object") return {};

  const payload = eventPayload as Record<string, unknown>;
  const override: Partial<EffectiveSettingsSnapshot> = {};

  const applyKeyValue = (key: string, value: unknown): void => {
    if (key === "videoBitrate") {
      const n = Number(value);
      if (Number.isFinite(n)) override.videoBitrate = clampNumber(n, 1000, 12000);
    }
    if (key === "audioBitrate") {
      const n = Number(value);
      if (Number.isFinite(n)) override.audioBitrate = clampNumber(n, 64, 320);
    }
    if (key === "defaultVolume") {
      const n = Number(value);
      if (Number.isFinite(n)) override.defaultVolume = clampNumber(n, 0, 100);
    }
    if (key === "syncMode") {
      override.syncMode = value === "client" ? "client" : "server";
    }
    if (key === "fullDownloadMode") {
      override.fullDownloadMode = parseBooleanSetting(value, false);
    }
    if (key === "debugMode") {
      override.debugMode = parseBooleanSetting(value, false);
    }
  };

  if (typeof payload.key === "string" && "value" in payload) {
    applyKeyValue(payload.key, payload.value);
  }

  if (payload.settings && typeof payload.settings === "object") {
    const settingsObj = payload.settings as Record<string, unknown>;
    for (const [key, value] of Object.entries(settingsObj)) {
      applyKeyValue(key, value);
    }
  }

  return override;
};

const resolveEffectiveSettings = (ctx: PluginContext): EffectivePluginSettings => {
  const rawVideoBitrate = Number(getSettingValue(ctx, "videoBitrate"));
  const rawAudioBitrate = Number(getSettingValue(ctx, "audioBitrate"));
  const rawDefaultVolume = Number(getSettingValue(ctx, "defaultVolume"));
  const rawSyncMode = getSettingValue(ctx, "syncMode");
  const rawFullDownloadMode = getSettingValue(ctx, "fullDownloadMode");
  const rawDebugMode = getSettingValue(ctx, "debugMode");

  const resolvedVideoBitrate = runtimeSettingsOverrides.videoBitrate ?? rawVideoBitrate;
  const resolvedAudioBitrate = runtimeSettingsOverrides.audioBitrate ?? rawAudioBitrate;
  const resolvedDefaultVolume = runtimeSettingsOverrides.defaultVolume ?? rawDefaultVolume;
  const resolvedSyncMode = runtimeSettingsOverrides.syncMode ?? rawSyncMode;
  const resolvedFullDownloadMode = runtimeSettingsOverrides.fullDownloadMode ?? rawFullDownloadMode;
  const resolvedDebugMode = runtimeSettingsOverrides.debugMode ?? rawDebugMode;

  const videoBitrateKbps = Number.isFinite(resolvedVideoBitrate)
    ? clampNumber(Number(resolvedVideoBitrate), 1000, 12000)
    : DEFAULT_SETTINGS.BITRATE_VIDEO;
  const audioBitrateKbps = Number.isFinite(resolvedAudioBitrate)
    ? clampNumber(Number(resolvedAudioBitrate), 64, 320)
    : DEFAULT_SETTINGS.BITRATE_AUDIO;
  const defaultVolume = Number.isFinite(resolvedDefaultVolume)
    ? clampNumber(Number(resolvedDefaultVolume), 0, 100)
    : DEFAULT_SETTINGS.DEFAULT_VOLUME;

  const syncMode: SyncMode = resolvedSyncMode === "client" ? "client" : "server";
  const fullDownloadMode = parseBooleanSetting(resolvedFullDownloadMode, false);
  const debugMode = parseBooleanSetting(resolvedDebugMode, false);

  return {
    videoBitrateKbps,
    audioBitrateKbps,
    defaultVolume,
    syncMode,
    fullDownloadMode,
    debugMode,
  };
};

const toSettingsSnapshot = (effective: EffectivePluginSettings): EffectiveSettingsSnapshot => ({
  videoBitrate: effective.videoBitrateKbps,
  audioBitrate: effective.audioBitrateKbps,
  defaultVolume: effective.defaultVolume,
  syncMode: effective.syncMode,
  fullDownloadMode: effective.fullDownloadMode,
  debugMode: effective.debugMode,
});

const getAdaptiveAudioDelayMs = (channelId: number, fullDownloadMode: boolean): number => {
  if (fullDownloadMode) return 0;
  const storedDelay = adaptiveAudioDelayMsByChannel.get(channelId);
  if (typeof storedDelay === "number" && Number.isFinite(storedDelay)) {
    return clampNumber(Math.round(storedDelay), MIN_AUDIO_DELAY_MS, MAX_AUDIO_DELAY_MS);
  }
  return DEFAULT_PROGRESSIVE_AUDIO_DELAY_MS;
};

const computeTrimmedAverageMs = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  if (samples.length < 5) {
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * 0.2);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) {
    return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  }
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};

const diffSettingsSnapshot = (
  previous: EffectiveSettingsSnapshot,
  current: EffectiveSettingsSnapshot
): Array<{ key: keyof EffectiveSettingsSnapshot; from: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot]; to: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot] }> => {
  const keys: Array<keyof EffectiveSettingsSnapshot> = [
    "videoBitrate",
    "audioBitrate",
    "defaultVolume",
    "syncMode",
    "fullDownloadMode",
    "debugMode",
  ];

  const changes: Array<{ key: keyof EffectiveSettingsSnapshot; from: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot]; to: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot] }> = [];
  for (const key of keys) {
    if (previous[key] !== current[key]) {
      changes.push({ key, from: previous[key], to: current[key] });
    }
  }
  return changes;
};

const logSettingsSnapshot = (
  ctx: PluginContext,
  trigger: string,
  eventPayload?: unknown,
  previousSnapshot?: EffectiveSettingsSnapshot
): EffectiveSettingsSnapshot => {
  const effective = resolveEffectiveSettings(ctx);
  const currentSnapshot = toSettingsSnapshot(effective);
  const changes = previousSnapshot ? diffSettingsSnapshot(previousSnapshot, currentSnapshot) : [];
  const structured = {
    trigger,
    timestamp: new Date().toISOString(),
    eventPayload,
    changedCount: changes.length,
    changed: changes,
    settings: currentSnapshot,
  };

  ctx.log(`[${PLUGIN_NAME}] [Settings] (${trigger})`, JSON.stringify(structured));
  ctx.log(
    `[${PLUGIN_NAME}] [Settings:Readable]`,
    `video=${effective.videoBitrateKbps}kbps | audio=${effective.audioBitrateKbps}kbps | volume=${effective.defaultVolume}% | syncMode=${effective.syncMode} | fullDownloadMode=${effective.fullDownloadMode} | debugMode=${effective.debugMode}`
  );

  if (changes.length > 0) {
    const diffReadable = changes.map((entry) => `${entry.key}: ${String(entry.from)} -> ${String(entry.to)}`).join(" | ");
    ctx.log(`[${PLUGIN_NAME}] [Settings:Changed]`, diffReadable);
  }

  return currentSnapshot;
};

/**
 * Format plugin settings for debug output with visual separation (REQ-026-A).
 * Only called when debugMode=true.
 */
const debugLogFormattedSettings = (ctx: PluginContext, effective: EffectivePluginSettings): void => {
  const settings = toSettingsSnapshot(effective);
  ctx.log(
    `\n${"═".repeat(70)}\n` +
    `║ 🎬 PLUGIN SETTINGS (Debug Mode Active)\n` +
    `${"═".repeat(70)}\n` +
    `║ 🎥 Video Bitrate:        ${effective.videoBitrateKbps} kbps\n` +
    `║ 🔊 Audio Bitrate:        ${effective.audioBitrateKbps} kbps\n` +
    `║ 🔉 Volume:               ${effective.defaultVolume}%\n` +
    `║ 🔄 Sync Mode:            ${effective.syncMode === "server" ? "Server-Side RTP" : "Client-Sync (Hybrid)"}\n` +
    `║ ⬇️  Full Download Mode:    ${effective.fullDownloadMode ? "ON (wait for complete download)" : "OFF (progressive start)"}\n` +
    `║ 🐛 Debug Mode:            ${effective.debugMode ? "ON ✓" : "OFF"}\n` +
    `${"═".repeat(70)}\n`
  );
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
    const settings = resolveEffectiveSettings(ctx);
    const debugMode = settings.debugMode;
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
    // RTP target is always local (ffmpeg runs in same container as Mediasoup)
    const rtpTargetHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;

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

    ctx.debug(`[stream:${channelId}] Creating Mediasoup transports on ${ip} (RTP target: ${rtpTargetHost})...`);

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
            mimeType: "video/H264",
            payloadType: 96,
            clockRate: 90000,
            parameters: {
              "packetization-mode": 1,
              "level-asymmetry-allowed": 1,
              "profile-level-id": "42e01f",
            },
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

    // 5. Get settings: volume, video bitrate, audio bitrate (REQ-018)
    // Use optional chaining to safely access settings API (may not be available in all Sharkord versions)
    const volume = syncController.getVolume(channelId);  // 0-100 from sync state
    const normalizedVolume = normalizeVolume(volume);
    const fullDownloadMode = settings.fullDownloadMode;
    const videoBitrate = `${settings.videoBitrateKbps}k`;
    const audioBitrate = `${settings.audioBitrateKbps}k`;
    const audioSyncDelayMs = getAdaptiveAudioDelayMs(channelId, fullDownloadMode);

    ctx.log(`[stream:${channelId}] Settings: volume=${volume}%, videoBitrate=${videoBitrate}, audioBitrate=${audioBitrate}, fullDownloadMode=${fullDownloadMode}`);
    ctx.log(`[stream:${channelId}] [SYNC] Audio delay compensation: ${audioSyncDelayMs}ms`);

    if (debugMode) {
      debugLogFormattedSettings(ctx, settings);
    }

    // 6. Spawn ffmpeg with RTP output (using temp-file buffering)
    // fullDownloadMode=true  -> complete download before start (REQ-036-A)
    // fullDownloadMode=false -> start without full download (REQ-036-B)
    let resolveSyncStart: (() => void) | null = null;
    const syncStartSignal = new Promise<void>((resolve) => {
      resolveSyncStart = resolve;
    });
    let readyTrackCount = 0;
    let syncStartReleased = false;
    let videoEnded = false;
    let audioEnded = false;
    let streamEndHandled = false;
    let audioProgressSeconds: number | null = null;
    let videoProgressSeconds: number | null = null;
    let audioProgressUpdatedAtMs: number | null = null;
    let videoProgressUpdatedAtMs: number | null = null;
    let lastDriftSampleSecond = -1;
    const driftSamplesMs: number[] = [];
    let driftAdapted = false;
    let ffmpegVideoProcRef: SpawnedProcess | null = null;
    let ffmpegAudioProcRef: SpawnedProcess | null = null;

    const collectDriftSample = (): void => {
      if (fullDownloadMode || driftAdapted) return;
      if (audioProgressSeconds === null || videoProgressSeconds === null) return;
      if (audioProgressUpdatedAtMs === null || videoProgressUpdatedAtMs === null) return;

      const pairAgeMs = Math.abs(audioProgressUpdatedAtMs - videoProgressUpdatedAtMs);
      if (pairAgeMs > DRIFT_PAIR_MAX_AGE_MS) return;

      const progressFloor = Math.min(audioProgressSeconds, videoProgressSeconds);
      if (progressFloor <= 0 || progressFloor > DRIFT_ADAPT_WINDOW_SECONDS) return;

      const sampleSecond = Math.floor(progressFloor);
      if (sampleSecond <= lastDriftSampleSecond) return;
      lastDriftSampleSecond = sampleSecond;

      const driftMs = Math.round((audioProgressSeconds - videoProgressSeconds) * 1000);
      if (Math.abs(driftMs) > 2000) return;
      driftSamplesMs.push(driftMs);

      if (driftSamplesMs.length >= DRIFT_SAMPLE_MIN_COUNT) {
        const avgDriftMs = computeTrimmedAverageMs(driftSamplesMs);
        const currentDelay = audioSyncDelayMs;
        const targetDelay = Math.round(currentDelay + avgDriftMs * DRIFT_ADAPT_GAIN);
        const stepLimitedDelay = clampNumber(
          targetDelay,
          currentDelay - MAX_DELAY_STEP_PER_STREAM_MS,
          currentDelay + MAX_DELAY_STEP_PER_STREAM_MS
        );
        const adaptedDelay = clampNumber(stepLimitedDelay, MIN_AUDIO_DELAY_MS, MAX_AUDIO_DELAY_MS);

        adaptiveAudioDelayMsByChannel.set(channelId, adaptedDelay);
        driftAdapted = true;
        ctx.log(
          `[stream:${channelId}] [SYNC] Dynamic drift avg=${Math.round(avgDriftMs)}ms over ${driftSamplesMs.length} samples; delay ${currentDelay}ms -> ${adaptedDelay}ms (target=${targetDelay}ms)`
        );
      }
    };

    const markTrackReady = (track: "VIDEO" | "AUDIO"): void => {
      readyTrackCount += 1;
      ctx.log(`[stream:${channelId}] [SYNC] ${track} ready (${readyTrackCount}/2)`);
      if (!syncStartReleased && readyTrackCount >= 2) {
        syncStartReleased = true;
        resolveSyncStart?.();
        ctx.log(`[stream:${channelId}] [SYNC] Start signal released for video+audio`);
      }
    };

    const handleTrackEnd = async (endedTrack: "video" | "audio"): Promise<void> => {
      if (endedTrack === "video") {
        videoEnded = true;
      } else {
        audioEnded = true;
      }

      if (streamEndHandled) return;
      streamEndHandled = true;

      if (!fullDownloadMode && !driftAdapted && driftSamplesMs.length > 0) {
        const avgDriftMs = computeTrimmedAverageMs(driftSamplesMs);
        const targetDelay = Math.round(audioSyncDelayMs + avgDriftMs * DRIFT_ADAPT_GAIN);
        const stepLimitedDelay = clampNumber(
          targetDelay,
          audioSyncDelayMs - MAX_DELAY_STEP_PER_STREAM_MS,
          audioSyncDelayMs + MAX_DELAY_STEP_PER_STREAM_MS
        );
        const adaptedDelay = clampNumber(stepLimitedDelay, MIN_AUDIO_DELAY_MS, MAX_AUDIO_DELAY_MS);
        adaptiveAudioDelayMsByChannel.set(channelId, adaptedDelay);
        ctx.log(
          `[stream:${channelId}] [SYNC] Final drift avg=${Math.round(avgDriftMs)}ms over ${driftSamplesMs.length} samples; delay ${audioSyncDelayMs}ms -> ${adaptedDelay}ms (target=${targetDelay}ms)`
        );
      }

      if (endedTrack === "video" && !audioEnded) {
        ctx.error(`[stream:${channelId}] Video ended before audio; forcing synchronized stop to avoid freeze/desync.`);
      }

      try {
        if (!videoEnded) ffmpegVideoProcRef?.kill();
      } catch {
        // process may already be gone
      }

      try {
        if (!audioEnded) ffmpegAudioProcRef?.kill();
      } catch {
        // process may already be gone
      }

      ctx.log(`[stream:${channelId}] Track ended (${endedTrack}), checking auto-advance`);
      try {
        await syncController.onVideoEnded(channelId);
      } catch (e) {
        ctx.error(`[stream:${channelId}] Error handling process exit:`, e);
      }
    };

    const videoSpawnPromise = spawnFfmpeg({
      streamType: "video",
      sourceUrl: item.streamUrl,
      youtubeUrl: item.youtubeUrl,
      formatId: item.videoFormatId,
      rtpHost: rtpTargetHost,
      rtpPort: (videoTransport as any).tuple?.localPort,
      payloadType: 96,
      ssrc: (videoProducer as any).rtpParameters?.encodings?.[0]?.ssrc || 1,
      bitrate: videoBitrate,
      debugEnabled: debugMode,
      waitForDownloadComplete: fullDownloadMode,
      expectedDurationSeconds: item.duration,
      notifyReadyForSyncStart: () => markTrackReady("VIDEO"),
      waitForSyncStartSignal: syncStartSignal,
      onProgressTimeSeconds: (seconds) => {
        videoProgressSeconds = seconds;
        videoProgressUpdatedAtMs = Date.now();
        collectDriftSample();
      },
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Video ffmpeg ended`);
        await handleTrackEnd("video");
      },
    });

    const audioSpawnPromise = spawnFfmpeg({
      streamType: "audio",
      sourceUrl: item.audioUrl,
      youtubeUrl: item.youtubeUrl,
      formatId: item.audioFormatId,
      rtpHost: rtpTargetHost,
      rtpPort: (audioTransport as any).tuple?.localPort,
      payloadType: 111,
      ssrc: (audioProducer as any).rtpParameters?.encodings?.[0]?.ssrc || 1,
      bitrate: audioBitrate,
      volume: normalizedVolume,
      syncDelayMs: audioSyncDelayMs,
      debugEnabled: debugMode,
      waitForDownloadComplete: fullDownloadMode,
      expectedDurationSeconds: item.duration,
      notifyReadyForSyncStart: () => markTrackReady("AUDIO"),
      waitForSyncStartSignal: syncStartSignal,
      onProgressTimeSeconds: (seconds) => {
        audioProgressSeconds = seconds;
        audioProgressUpdatedAtMs = Date.now();
        collectDriftSample();
      },
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Audio ffmpeg ended`);
        await handleTrackEnd("audio");
      },
    });

    const spawnResults = await Promise.allSettled([videoSpawnPromise, audioSpawnPromise]);
    const failedSpawn = spawnResults.find((result) => result.status === "rejected");
    if (failedSpawn) {
      if (!syncStartReleased) {
        syncStartReleased = true;
        resolveSyncStart?.();
      }

      for (const result of spawnResults) {
        if (result.status === "fulfilled") {
          try { result.value.kill(); } catch { /* */ }
        }
      }

      throw failedSpawn.reason instanceof Error
        ? failedSpawn.reason
        : new Error(String(failedSpawn.reason));
    }

    const ffmpegVideoProc = (spawnResults[0] as PromiseFulfilledResult<SpawnedProcess>).value;
    const ffmpegAudioProc = (spawnResults[1] as PromiseFulfilledResult<SpawnedProcess>).value;
    ffmpegVideoProcRef = ffmpegVideoProc;
    ffmpegAudioProcRef = ffmpegAudioProc;

    ctx.log(`[stream:${channelId}] ffmpeg spawned (video PID: ${ffmpegVideoProc.process.pid}, audio PID: ${ffmpegAudioProc.process.pid})`);

    const preparationTitle = `⏳ Wird vorbereitet… — ${item.title}`;

    // 7. Register stream with Sharkord using real Mediasoup producers
    const streamHandle = ctx.actions.voice.createStream({
      channelId,
      key: STREAM_KEY,
      title: preparationTitle,
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
      videoTempFile: ffmpegVideoProc.tempFilePath,
      audioTempFile: ffmpegAudioProc.tempFilePath,
      debugEnabled: debugMode,
    };

    streamManager.setActive(channelId, resources);

    // Monitor producer score/statistics to verify RTP delivery in runtime logs
    let streamingDetected = false;
    monitorProducers(
      ctx,
      channelId,
      videoProducer,
      audioProducer,
      streamHandle,
      item.title,
      () => {
        streamingDetected = true;
      }
    );
    scheduleHealthCheck(ctx, channelId, videoProducer, audioProducer);

    setTimeout(() => {
      if (!streamManager.isActive(channelId)) return;
      if (streamingDetected) return;
      ctx.error(`[stream:${channelId}] ⚠ Stream preparation timeout: no STREAMING signal after 30s.`);
      try {
        streamHandle.update({ title: `⚠ Vorbereitung dauert ungewöhnlich lange — ${item.title}` });
      } catch {
        // ignore title update failures on timeout warning
      }
    }, 30_000);

    // Auto-advance is handled by the audio ffmpeg onEnd callback.
    // Monitoring only the video process can cause premature cleanup when
    // video exits earlier than audio (e.g., temporary decode/input issues).
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
  videoTitle?: string,
  onStreamingDetected?: () => void
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
        onStreamingDetected?.();
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
      onStreamingDetected?.();
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

  settingsAccessor = null;
  runtimeSettingsOverrides = {};

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
  const settingsRegistrationResult = ctx.settings.register([
    {
      key: "videoBitrate",
      name: "Video-Bitrate (kbps)",
      type: "number",
      description:
        "Controlls video quality and file size for RTP streaming. Higher values = better quality, more bandwidth needed. " +
        "Recommended: 2500–4000 kbps for standard, 4000–6000 kbps for HD. " +
        "Range: 1000–12000 kbps. " +
        "Example: 3000, 4000, 6000. " +
        "[REQ-018-A]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_VIDEO,
      min: 1000,
      max: 12000,
    },
    {
      key: "audioBitrate",
      name: "Audio-Bitrate (kbps)",
      type: "number",
      description:
        "Controlls audio quality for RTP streaming. 128 kbps is standard quality for most users, 192+ kbps for high-fidelity audio. " +
        "Recommended: 128 kbps (standard), 192 kbps (high quality). " +
        "Range: 64–320 kbps. " +
        "Example: 128, 192. " +
        "[REQ-018-B]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_AUDIO,
      min: 64,
      max: 320,
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
      key: "fullDownloadMode",
      name: "Full-Download-Modus",
      type: "boolean",
      description:
        "When enabled, videos are fully downloaded before playback starts. " +
        "When disabled, playback starts while download is still in progress (faster start). " +
        "Default: disabled. " +
        "[REQ-036]",
      defaultValue: false,
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
  ]) as unknown;

  const registrationMaybePromise = settingsRegistrationResult as { then?: (cb: (value: unknown) => unknown) => unknown };
  if (typeof registrationMaybePromise?.then === "function") {
    try {
      const resolved = await Promise.resolve(settingsRegistrationResult);
      const accessor = resolved as { get?: <T = unknown>(key: string) => T | undefined };
      if (typeof accessor?.get === "function") {
        settingsAccessor = { get: accessor.get.bind(accessor) };
      }
    } catch {
      // fallback to ctx.settings.get only
    }
  } else {
    const accessor = settingsRegistrationResult as { get?: <T = unknown>(key: string) => T | undefined };
    if (typeof accessor?.get === "function") {
      settingsAccessor = { get: accessor.get.bind(accessor) };
    }
  }

  // 4. Register all commands (REQ-001, REQ-004-013)
  registerPlayCommand(ctx as never, queueManager, syncController);
  registerQueueCommand(ctx as never, queueManager);
  registerSkipCommand(ctx as never, syncController, streamManager);
  registerRemoveCommand(ctx as never, queueManager);
  registerStopCommand(ctx as never, syncController, streamManager);
  registerNowPlayingCommand(ctx as never, queueManager);
  registerPauseCommand(ctx as never, syncController, streamManager);
  registerResumeCommand(ctx as never, syncController, streamManager);
  registerVolumeCommand(ctx as never, syncController);
  registerDebugCacheCommand(ctx as never);

  // 4b. Register UI components explicitly when runtime API is available (REQ-017)
  // Some Sharkord runtimes expose only static component export wiring.
  const uiApi = (ctx as { ui?: { registerComponents?: (components: unknown) => void } }).ui;
  if (typeof uiApi?.registerComponents === "function") {
    uiApi.registerComponents(pluginComponents);
  } else {
    ctx.debug(`[${PLUGIN_NAME}] Runtime has no ctx.ui.registerComponents(); using exported components fallback.`);
  }

  // 5. Log all current settings at startup (REQ-039)
  // Must always log, independent of debug mode.
  let previousSettingsSnapshot = logSettingsSnapshot(ctx, "plugin:loaded");

  // 5b. Listen for settings changes/saves and log effective settings (REQ-039)
  ctx.events.on("settings:changed", (...args: unknown[]) => {
    const payload = args[0];
    const overrides = extractRuntimeSettingOverrides(payload);
    runtimeSettingsOverrides = { ...runtimeSettingsOverrides, ...overrides };
    previousSettingsSnapshot = logSettingsSnapshot(ctx, "settings:changed", args, previousSettingsSnapshot);
  });

  // 5c. Fallback watcher: some runtimes may not emit `settings:changed` reliably.
  // Always-on detection ensures persisted setting changes are logged regardless of debug mode.
  if (settingsWatcher) {
    clearInterval(settingsWatcher);
    settingsWatcher = null;
  }
  settingsWatcher = setInterval(() => {
    const currentSnapshot = toSettingsSnapshot(resolveEffectiveSettings(ctx));
    const changes = diffSettingsSnapshot(previousSettingsSnapshot, currentSnapshot);
    if (changes.length > 0) {
      previousSettingsSnapshot = logSettingsSnapshot(
        ctx,
        "settings:detected",
        { source: "poll" },
        previousSettingsSnapshot
      );
    }
  }, 2000);

  // 6. Listen for voice channel close events (REQ-016)
  ctx.events.on("voice:runtime_closed", handleVoiceRuntimeClosed(ctx));

  ctx.log(`[${PLUGIN_NAME}] Loaded successfully.`);
};

/**
 * Called when the plugin is unloaded by Sharkord. (REQ-016)
 * Cleans up all active streams, queues, and event listeners.
 */
export const onUnload = (ctx: PluginContext): void => {
  ctx.log(`[${PLUGIN_NAME}] Unloading...`);

  settingsAccessor = null;
  runtimeSettingsOverrides = {};

  if (settingsWatcher) {
    clearInterval(settingsWatcher);
    settingsWatcher = null;
  }

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
