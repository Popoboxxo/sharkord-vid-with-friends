/**
 * Stream track synchronisation helpers.
 *
 * Manages drift sampling, track readiness signalling,
 * and end-of-stream handling.
 */
import type { PluginContext } from "../utils/settings";
import type { SpawnedProcess } from "../stream/ffmpeg";
import { StreamManager } from "../stream/stream-manager";
import { SyncController } from "../sync/sync-controller";
import {
  adaptiveAudioDelayMsByChannel,
  computeTrimmedAverageMs,
  DRIFT_ADAPT_GAIN,
  DRIFT_PAIR_MAX_AGE_MS,
  DRIFT_SAMPLE_MIN_COUNT,
  DRIFT_ADAPT_WINDOW_SECONDS,
  MAX_DELAY_STEP_PER_STREAM_MS,
  MIN_AUDIO_DELAY_MS,
  MAX_AUDIO_DELAY_MS,
} from "./streaming-state";

export type StreamSyncContext = {
  channelId: number;
  fullDownloadMode: boolean;
  audioSyncDelayMs: number;
  resolveSyncStart: (() => void) | null;
  readyTrackCount: number;
  syncStartReleased: boolean;
  videoEnded: boolean;
  audioEnded: boolean;
  streamEndHandled: boolean;
  audioProgressSeconds: number | null;
  videoProgressSeconds: number | null;
  audioProgressUpdatedAtMs: number | null;
  videoProgressUpdatedAtMs: number | null;
  lastDriftSampleSecond: number;
  driftSamplesMs: number[];
  driftAdapted: boolean;
  ffmpegVideoProcRef: SpawnedProcess | null;
  ffmpegAudioProcRef: SpawnedProcess | null;
};

export function createStreamSyncContext(
  channelId: number,
  fullDownloadMode: boolean,
  audioSyncDelayMs: number
): StreamSyncContext {
  return {
    channelId,
    fullDownloadMode,
    audioSyncDelayMs,
    resolveSyncStart: null,
    readyTrackCount: 0,
    syncStartReleased: false,
    videoEnded: false,
    audioEnded: false,
    streamEndHandled: false,
    audioProgressSeconds: null,
    videoProgressSeconds: null,
    audioProgressUpdatedAtMs: null,
    videoProgressUpdatedAtMs: null,
    lastDriftSampleSecond: -1,
    driftSamplesMs: [],
    driftAdapted: false,
    ffmpegVideoProcRef: null,
    ffmpegAudioProcRef: null,
  };
}

export const collectDriftSample = (ctx: PluginContext, sync: StreamSyncContext): void => {
  if (sync.fullDownloadMode || sync.driftAdapted) return;
  if (sync.audioProgressSeconds === null || sync.videoProgressSeconds === null) return;
  if (sync.audioProgressUpdatedAtMs === null || sync.videoProgressUpdatedAtMs === null) return;

  const pairAgeMs = Math.abs(sync.audioProgressUpdatedAtMs - sync.videoProgressUpdatedAtMs);
  if (pairAgeMs > DRIFT_PAIR_MAX_AGE_MS) return;

  const progressFloor = Math.min(sync.audioProgressSeconds, sync.videoProgressSeconds);
  if (progressFloor <= 0 || progressFloor > DRIFT_ADAPT_WINDOW_SECONDS) return;

  const sampleSecond = Math.floor(progressFloor);
  if (sampleSecond <= sync.lastDriftSampleSecond) return;
  sync.lastDriftSampleSecond = sampleSecond;

  const driftMs = Math.round((sync.audioProgressSeconds - sync.videoProgressSeconds) * 1000);
  if (Math.abs(driftMs) > 2000) return;
  sync.driftSamplesMs.push(driftMs);

  if (sync.driftSamplesMs.length >= DRIFT_SAMPLE_MIN_COUNT) {
    const avgDriftMs = computeTrimmedAverageMs(sync.driftSamplesMs);
    const currentDelay = sync.audioSyncDelayMs;
    const targetDelay = Math.round(currentDelay + avgDriftMs * DRIFT_ADAPT_GAIN);
    const stepLimitedDelay = Math.max(
      currentDelay - MAX_DELAY_STEP_PER_STREAM_MS,
      Math.min(currentDelay + MAX_DELAY_STEP_PER_STREAM_MS, targetDelay)
    );
    const adaptedDelay = Math.max(MIN_AUDIO_DELAY_MS, Math.min(MAX_AUDIO_DELAY_MS, stepLimitedDelay));

    adaptiveAudioDelayMsByChannel.set(sync.channelId, adaptedDelay);
    sync.driftAdapted = true;
    ctx.log(
      `[stream:${sync.channelId}] [SYNC] Dynamic drift avg=${Math.round(avgDriftMs)}ms over ${sync.driftSamplesMs.length} samples; delay ${currentDelay}ms -> ${adaptedDelay}ms (target=${targetDelay}ms)`
    );
  }
};

export const markTrackReady = (ctx: PluginContext, sync: StreamSyncContext, track: "VIDEO" | "AUDIO"): void => {
  sync.readyTrackCount += 1;
  ctx.log(`[stream:${sync.channelId}] [SYNC] ${track} ready (${sync.readyTrackCount}/2)`);
  if (!sync.syncStartReleased && sync.readyTrackCount >= 2) {
    sync.syncStartReleased = true;
    sync.resolveSyncStart?.();
    ctx.log(`[stream:${sync.channelId}] [SYNC] Start signal released for video+audio`);
  }
};

export const handleTrackEnd = async (
  ctx: PluginContext,
  sync: StreamSyncContext,
  endedTrack: "video" | "audio",
  streamManager: StreamManager,
  syncController: SyncController
): Promise<void> => {
  if (endedTrack === "video") {
    sync.videoEnded = true;
  } else {
    sync.audioEnded = true;
  }

  if (sync.streamEndHandled) return;
  sync.streamEndHandled = true;

  if (!sync.fullDownloadMode && !sync.driftAdapted && sync.driftSamplesMs.length > 0) {
    const avgDriftMs = computeTrimmedAverageMs(sync.driftSamplesMs);
    const targetDelay = Math.round(sync.audioSyncDelayMs + avgDriftMs * DRIFT_ADAPT_GAIN);
    const stepLimitedDelay = Math.max(
      sync.audioSyncDelayMs - MAX_DELAY_STEP_PER_STREAM_MS,
      Math.min(sync.audioSyncDelayMs + MAX_DELAY_STEP_PER_STREAM_MS, targetDelay)
    );
    const adaptedDelay = Math.max(MIN_AUDIO_DELAY_MS, Math.min(MAX_AUDIO_DELAY_MS, stepLimitedDelay));
    adaptiveAudioDelayMsByChannel.set(sync.channelId, adaptedDelay);
    ctx.log(
      `[stream:${sync.channelId}] [SYNC] Final drift avg=${Math.round(avgDriftMs)}ms over ${sync.driftSamplesMs.length} samples; delay ${sync.audioSyncDelayMs}ms -> ${adaptedDelay}ms (target=${targetDelay}ms)`
    );
  }

  if (endedTrack === "video" && !sync.audioEnded) {
    ctx.error(`[stream:${sync.channelId}] Video ended before audio; forcing synchronized stop to avoid freeze/desync.`);
  }

  try {
    if (!sync.videoEnded) sync.ffmpegVideoProcRef?.kill();
  } catch { /* */ }
  try {
    if (!sync.audioEnded) sync.ffmpegAudioProcRef?.kill();
  } catch { /* */ }

  if (!sync.videoEnded || !sync.audioEnded) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  ctx.log(`[stream:${sync.channelId}] Track ended (${endedTrack}), checking auto-advance`);
  try {
    await syncController.onVideoEnded(sync.channelId);
  } catch (e) {
    ctx.error(`[stream:${sync.channelId}] Error handling process exit:`, e);
  }
};
