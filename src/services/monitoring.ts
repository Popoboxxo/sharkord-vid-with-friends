/**
 * Producer monitoring, health checks and process watchers.
 */
import type { PluginContext } from "../utils/settings";
import type { SpawnedProcess } from "../stream/ffmpeg";
import type { StreamHandleLike } from "../stream/stream-manager";
import { StreamManager } from "../stream/stream-manager";
import { SyncController } from "../sync/sync-controller";

/**
 * Monitor Mediasoup producer score events for RTP delivery diagnostics. (REQ-026)
 */
export const monitorProducers = (
  ctx: PluginContext,
  channelId: number,
  videoProducer: unknown,
  audioProducer: unknown,
  streamHandle?: StreamHandleLike,
  videoTitle?: string,
  onStreamingDetected?: () => void
): void => {
  const vp = videoProducer as { observer?: { on: (e: string, h: (...a: unknown[]) => void) => void } };
  const ap = audioProducer as { observer?: { on: (e: string, h: (...a: unknown[]) => void) => void } };

  let titleUpdated = false;

  try {
    vp.observer?.on("score", (score: unknown) => {
      ctx.log(`[stream:${channelId}] [Video Producer] Score update:`, JSON.stringify(score));
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
 */
export const scheduleHealthCheck = (
  ctx: PluginContext,
  channelId: number,
  videoProducer: unknown,
  audioProducer: unknown,
  streamManager: StreamManager
): void => {
  setTimeout(async () => {
    if (!streamManager.isActive(channelId)) {
      ctx.debug(`[health:${channelId}] Stream no longer active, skipping check`);
      return;
    }

    ctx.log(`[health:${channelId}] === Stream Health Check (5s after start) ===`);

    const vp = videoProducer as { getStats?: () => Promise<unknown[]>; closed?: boolean; paused?: boolean; score?: unknown };
    const ap = audioProducer as { getStats?: () => Promise<unknown[]>; closed?: boolean; paused?: boolean; score?: unknown };

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
            ctx.error(`[health:${channelId}] ⚠ NO VIDEO RTP DATA RECEIVED!`);
          } else {
            ctx.log(`[health:${channelId}] ✓ Video RTP data flowing`);
          }
        } else {
          ctx.error(`[health:${channelId}] ⚠ Video producer getStats() returned empty`);
        }
      } else {
        ctx.debug(`[health:${channelId}] Video producer has no getStats() method`);
      }
    } catch (err) {
      ctx.error(`[health:${channelId}] Video health check error:`, err);
    }

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
          ctx.error(`[health:${channelId}] ⚠ Audio producer getStats() returned empty`);
        }
      } else {
        ctx.debug(`[health:${channelId}] Audio producer has no getStats() method`);
      }
    } catch (err) {
      ctx.error(`[health:${channelId}] Audio health check error:`, err);
    }

    const resources = streamManager.getResources(channelId);
    if (resources) {
      const vpExitCode = resources.videoProcess?.process?.exitCode;
      const apExitCode = resources.audioProcess?.process?.exitCode;
      ctx.log(`[health:${channelId}] ffmpeg Video: ${vpExitCode === null ? "RUNNING" : `EXITED (code ${vpExitCode})`}`);
      ctx.log(`[health:${channelId}] ffmpeg Audio: ${apExitCode === null ? "RUNNING" : `EXITED (code ${apExitCode})`}`);
    }

    ctx.log(`[health:${channelId}] === End Health Check ===`);
  }, 5000);
};

/**
 * Watch a ffmpeg process and trigger auto-advance when it exits. (REQ-009)
 */
export const monitorProcess = (
  ctx: PluginContext,
  channelId: number,
  ffmpegProcess: SpawnedProcess,
  streamManager: StreamManager,
  syncController: SyncController
): void => {
  ffmpegProcess.process.exited
    .then(async () => {
      ctx.debug(`[stream:${channelId}] ffmpeg process exited, checking auto-advance`);
      streamManager.cleanup(channelId);
      await syncController.onVideoEnded(channelId);
    })
    .catch((err: unknown) => {
      ctx.error(`[stream:${channelId}] ffmpeg process error:`, err);
    });
};

/**
 * Monitor HLS ffmpeg process for auto-advance (REQ-009, HLS variant)
 */
export const monitorProcessForAutoAdvance = (
  ctx: PluginContext,
  channelId: number,
  bunProcess: ReturnType<typeof Bun.spawn>,
  streamManager: StreamManager,
  syncController: SyncController
): void => {
  bunProcess.exited
    .then(async () => {
      ctx.log(`[stream:${channelId}] HLS ffmpeg process exited, checking auto-advance`);
      streamManager.cleanup(channelId);
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
