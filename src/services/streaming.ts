/**
 * Stream orchestration — start a full video+audio stream for a channel.
 *
 * Pipeline: yt-dlp → ffmpeg → Mediasoup → Sharkord
 */
import type { QueueItem } from "../queue/types";
import { normalizeVolume, spawnFfmpeg } from "../stream/ffmpeg";
import type { FfmpegLoggers, SpawnedProcess } from "../stream/ffmpeg";
import { StreamManager } from "../stream/stream-manager";
import { SyncController } from "../sync/sync-controller";
import { STREAM_KEY } from "../utils/constants";
import type { PluginContext } from "../utils/settings";
import { resolveEffectiveSettings } from "../utils/settings";
import { debugLogFormattedSettings } from "../utils/debug";
import { resolveVoiceActions } from "../utils/voice-compat";
import {
  getAdaptiveAudioDelayMs,
  lastStreamModeMsByChannel,
  adaptiveAudioDelayMsByChannel,
} from "./streaming-state";
import { createStreamSyncContext, markTrackReady, handleTrackEnd, collectDriftSample } from "./streaming-sync";
import { createMediasoupProducers } from "./streaming-setup";
import { monitorProducers, scheduleHealthCheck } from "./monitoring";
import { queueManager } from "../utils/plugin-state";

export const startStream = async (
  ctx: PluginContext,
  channelId: number,
  item: QueueItem,
  streamManager: StreamManager,
  syncController: SyncController
): Promise<void> => {
  try {
    const settings = resolveEffectiveSettings(ctx);
    const debugMode = settings.debugMode;
    const loggers: FfmpegLoggers = {
      log: (...m) => ctx.log(`[stream:${channelId}]`, ...m),
      error: (...m) => ctx.error(`[stream:${channelId}]`, ...m),
      debug: (...m) => {
        if (debugMode) ctx.log(`[DEBUG:stream:${channelId}]`, ...m);
        else ctx.debug(`[stream:${channelId}]`, ...m);
      },
    };

    ctx.log(`[stream:${channelId}] Starting RTP stream: ${item.title}`);
    streamManager.cleanup(channelId);

    const voiceActions = resolveVoiceActions(ctx);
    const router = voiceActions.getRouter(channelId);
    const { ip, announcedAddress } = await voiceActions.getListenInfo();

    if (!router) {
      throw new Error(`No Mediasoup router available for channel ${channelId}`);
    }

    const { audioTransport, videoTransport, audioProducer, videoProducer, rtpTargetHost } =
      await createMediasoupProducers(ctx, channelId, router, ip, announcedAddress);

    const volume = syncController.getVolume(channelId);
    const normalizedVolume = normalizeVolume(volume);
    const fullDownloadMode = settings.fullDownloadMode;
    const videoBitrate = `${settings.videoBitrateKbps}k`;
    const audioBitrate = `${settings.audioBitrateKbps}k`;

    const lastMode = lastStreamModeMsByChannel.get(channelId);
    if (lastMode !== undefined && lastMode !== fullDownloadMode) {
      ctx.log(`[stream:${channelId}] [SYNC] Mode changed — resetting adaptive audio delay`);
      adaptiveAudioDelayMsByChannel.delete(channelId);
    }
    lastStreamModeMsByChannel.set(channelId, fullDownloadMode);
    const audioSyncDelayMs = getAdaptiveAudioDelayMs(channelId, fullDownloadMode);

    ctx.log(`[stream:${channelId}] Settings: volume=${volume}%, videoBitrate=${videoBitrate}, audioBitrate=${audioBitrate}, fullDownloadMode=${fullDownloadMode}`);
    ctx.log(`[stream:${channelId}] [SYNC] Audio delay compensation: ${audioSyncDelayMs}ms`);
    if (debugMode) debugLogFormattedSettings(ctx, settings);

    const sync = createStreamSyncContext(channelId, fullDownloadMode, audioSyncDelayMs);
    const syncStartSignal = new Promise<void>((resolve) => { sync.resolveSyncStart = resolve; });

    const phaseCallbackRef: { fn: ((phase: "DOWNLOADING" | "BUFFERING" | "STREAMING") => void) | null } = { fn: null };

    const videoPromise = spawnFfmpeg({
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
      notifyReadyForSyncStart: () => markTrackReady(ctx, sync, "VIDEO"),
      waitForSyncStartSignal: syncStartSignal,
      onPhaseChange: (phase) => phaseCallbackRef.fn?.(phase),
      onProgressTimeSeconds: (seconds) => {
        sync.videoProgressSeconds = seconds;
        sync.videoProgressUpdatedAtMs = Date.now();
        collectDriftSample(ctx, sync);
      },
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Video ffmpeg ended`);
        await handleTrackEnd(ctx, sync, "video", streamManager, syncController);
      },
    });

    const audioPromise = spawnFfmpeg({
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
      notifyReadyForSyncStart: () => markTrackReady(ctx, sync, "AUDIO"),
      waitForSyncStartSignal: syncStartSignal,
      onProgressTimeSeconds: (seconds) => {
        sync.audioProgressSeconds = seconds;
        sync.audioProgressUpdatedAtMs = Date.now();
        collectDriftSample(ctx, sync);
      },
      loggers,
      onEnd: async () => {
        ctx.log(`[stream:${channelId}] Audio ffmpeg ended`);
        await handleTrackEnd(ctx, sync, "audio", streamManager, syncController);
      },
    });

    const results = await Promise.allSettled([videoPromise, audioPromise]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      if (!sync.syncStartReleased) { sync.syncStartReleased = true; sync.resolveSyncStart?.(); }
      for (const r of results) {
        if (r.status === "fulfilled") { try { r.value.kill(); } catch { /* */ } }
      }
      throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
    }

    const ffmpegVideoProc = (results[0] as PromiseFulfilledResult<SpawnedProcess>).value;
    const ffmpegAudioProc = (results[1] as PromiseFulfilledResult<SpawnedProcess>).value;
    sync.ffmpegVideoProcRef = ffmpegVideoProc;
    sync.ffmpegAudioProcRef = ffmpegAudioProc;

    ctx.log(`[stream:${channelId}] ffmpeg spawned (video PID: ${ffmpegVideoProc.process.pid}, audio PID: ${ffmpegAudioProc.process.pid})`);

    const preparationTitle = `⏳ Wird vorbereitet… — ${item.title}`;
    const streamHandle = voiceActions.createStream({
      channelId,
      key: STREAM_KEY,
      title: preparationTitle,
      producers: { audio: audioProducer, video: videoProducer },
    });

    phaseCallbackRef.fn = (phase) => {
      const title = phase === "BUFFERING" ? `⏸ Wird gepuffert… — ${item.title}` : item.title;
      try { streamHandle.update({ title }); } catch { /* */ }
    };

    streamManager.setActive(channelId, {
      audioTransport: audioTransport as any,
      videoTransport: videoTransport as any,
      audioProducer: audioProducer as any,
      videoProducer: videoProducer as any,
      videoProcess: ffmpegVideoProc,
      audioProcess: ffmpegAudioProc,
      streamHandle,
      router: router as any,
      videoTempFile: ffmpegVideoProc.tempFilePath,
      audioTempFile: ffmpegAudioProc.tempFilePath,
      debugEnabled: debugMode,
    });

    if (debugMode) {
      const avTimer = setInterval(() => {
        if (!streamManager.isActive(channelId)) { clearInterval(avTimer); return; }
        const vPts = ffmpegVideoProc.getLastPtsSeconds();
        const aPts = ffmpegAudioProc.getLastPtsSeconds();
        if (vPts === 0 && aPts === 0) return;
        const driftMs = Math.round((aPts - vPts) * 1000);
        if (Math.abs(driftMs) > 40) {
          ctx.log(`[stream:${channelId}] [av-sync] WARNING: AV drift ${driftMs}ms`);
        } else {
          ctx.log(`[stream:${channelId}] [av-sync] drift=${driftMs}ms`);
        }
      }, 5000);
    }

    streamManager.startWatchdog(channelId, {
      expectedDurationSeconds: item.duration ?? 0,
      loggers,
      onPrematureExit: async (retryCount) => {
        ctx.error(`[stream:${channelId}] [watchdog] Premature exit — retry ${retryCount}`);
        streamManager.cleanup(channelId);
        try { await syncController.play(channelId); } catch (e) { /* */ }
      },
      onFatalExit: () => {
        ctx.error(`[stream:${channelId}] [watchdog] FATAL: stream died after max retries`);
        queueManager.skip(channelId);
        streamManager.cleanup(channelId);
        syncController.setPlaying(channelId, false);
      },
    });

    let streamingDetected = false;
    monitorProducers(ctx, channelId, videoProducer, audioProducer, streamHandle, item.title, () => { streamingDetected = true; });
    scheduleHealthCheck(ctx, channelId, videoProducer, audioProducer, streamManager);

    setTimeout(() => {
      if (!streamManager.isActive(channelId) || streamingDetected) return;
      ctx.error(`[stream:${channelId}] ⚠ Stream preparation timeout after 30s`);
      try { streamHandle.update({ title: `⚠ Vorbereitung dauert — ${item.title}` }); } catch { /* */ }
    }, 30_000);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.error(`[startStream] FATAL ERROR for channel ${channelId}:`, msg);
    streamManager.cleanup(channelId);
    syncController.stop(channelId);
    throw new Error(`Stream startup failed: ${msg}`);
  }
};
