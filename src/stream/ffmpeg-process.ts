/**
 * ffmpeg process orchestration — spawnFfmpeg and binary test.
 */

import path from "path";
import { mkdirSync } from "fs";
import {
  getFfmpegPath,
  shouldWaitForDownloadComplete,
  shouldUseLockedFormatId,
  extractYouTubeId,
  inferTempExtension,
  buildTempFilePath,
} from "./ffmpeg-utils";
import { buildVideoStreamArgs, buildAudioStreamArgs } from "./ffmpeg-config";
import { createYtDlpState, cleanupTempFile, spawnYtDlpDownload } from "./ffmpeg-download";
import { waitForCompleteDownload, waitForProgressiveBuffer } from "./ffmpeg-buffer";
import { launchFfmpegStream } from "./ffmpeg-ffmpeg";
import type { SpawnFfmpegOptions, SpawnedProcess, FfmpegLoggers } from "./ffmpeg-types";

/**
 * Spawn ffmpeg process that reads from a temp file (downloaded by yt-dlp in parallel).
 *
 * REQ-002: Stable temp-file streaming approach.
 */
export const spawnFfmpeg = async (options: SpawnFfmpegOptions): Promise<SpawnedProcess> => {
  const {
    streamType, sourceUrl, youtubeUrl, formatId, rtpHost, rtpPort, payloadType, ssrc, bitrate,
    volume = 1, syncDelayMs = 0, debugEnabled = false, waitForDownloadComplete,
    expectedDurationSeconds, waitForSyncStartSignal, notifyReadyForSyncStart,
    onProgressTimeSeconds, loggers, onPhaseChange, onEnd,
  } = options;

  const ffmpegPath = getFfmpegPath();
  const binDir = path.dirname(ffmpegPath);
  const ytDlpPath = path.join(binDir, "yt-dlp");
  const tag = streamType.toUpperCase();

  const waitForFullDownload = waitForDownloadComplete ?? shouldWaitForDownloadComplete(streamType);
  const progressiveMode = !waitForFullDownload;
  const useLockedFormatId = shouldUseLockedFormatId(waitForFullDownload);
  const preferredFormatId = useLockedFormatId ? formatId : undefined;
  const useDirectVideoInput = false;

  const videoId = extractYouTubeId(youtubeUrl || "");
  const tempExtension = inferTempExtension(streamType, preferredFormatId, progressiveMode);
  const tempFilePath = useDirectVideoInput
    ? undefined
    : buildTempFilePath(videoId, streamType, tempExtension);

  const cleanup = (): void => cleanupTempFile(tempFilePath, debugEnabled, tag, loggers);

  const ytDlpState = createYtDlpState();

  if (!useDirectVideoInput && tempFilePath) {
    const cacheDir = path.dirname(tempFilePath);
    mkdirSync(cacheDir, { recursive: true });

    loggers.log(`[${tag}]`, `Phase: DOWNLOADING — yt-dlp downloading to: ${path.basename(tempFilePath)}`);

    spawnYtDlpDownload(ytDlpState, {
      ytDlpPath, binDir, sourceUrl, youtubeUrl,
      formatId: preferredFormatId, streamType, debugEnabled,
      tempFilePath, videoId, loggers, tag,
    });

    loggers.log(`[Phase] DOWNLOADING — yt-dlp pipe started on temp file: ${path.basename(tempFilePath)}`);
    onPhaseChange?.("DOWNLOADING");
  }

  loggers.log(`[${tag}]`, `[RTP Config] PT=${payloadType}, SSRC=${ssrc}, dest=rtp://${rtpHost}:${rtpPort}`);

  if (!useDirectVideoInput && waitForFullDownload && tempFilePath) {
    await waitForCompleteDownload({
      state: ytDlpState, tempFilePath, preferredFormatId,
      tag, loggers, notifyReadyForSyncStart, waitForSyncStartSignal,
      cleanup, ytDlpPath, binDir, sourceUrl, youtubeUrl, streamType, debugEnabled, videoId,
    });
  } else if (!useDirectVideoInput && tempFilePath) {
    await waitForProgressiveBuffer({
      state: ytDlpState, tempFilePath, streamType,
      tag, loggers, notifyReadyForSyncStart, waitForSyncStartSignal,
      cleanup, onPhaseChange, ytDlpPath, binDir, sourceUrl, youtubeUrl, preferredFormatId, debugEnabled, videoId,
    });
  }

  const useRealtimeReading = true;
  const ffmpegInput = useDirectVideoInput ? sourceUrl : tempFilePath;
  if (!ffmpegInput) {
    cleanup();
    throw new Error(`${tag}: missing ffmpeg input`);
  }

  const fullDownloadModePassed = !useDirectVideoInput ? true : waitForFullDownload;
  const args = streamType === "video"
    ? buildVideoStreamArgs({
        inputPath: ffmpegInput, rtpHost, rtpPort, payloadType, ssrc, bitrate,
        realtimeReading: useRealtimeReading, fullDownloadMode: fullDownloadModePassed, debugEnabled,
      })
    : buildAudioStreamArgs({
        inputPath: ffmpegInput, rtpHost, rtpPort, payloadType, ssrc, bitrate,
        volume, syncDelayMs, realtimeReading: useRealtimeReading, fullDownloadMode: fullDownloadModePassed, debugEnabled,
      });

  return launchFfmpegStream({
    ffmpegPath, args, tag, loggers, debugEnabled, fullDownloadModePassed,
    onProgressTimeSeconds, expectedDurationSeconds, onPhaseChange, onEnd,
    cleanup, ytDlpProc: ytDlpState.proc,
  });
};

/**
 * Test if ffmpeg binary is available and functional.
 * Returns version info if successful, throws an error otherwise.
 */
export const testFfmpegBinary = async (loggers?: FfmpegLoggers): Promise<string> => {
  const ffmpegPath = getFfmpegPath();

  try {
    const proc = Bun.spawn({
      cmd: [ffmpegPath, "-version"],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`ffmpeg returned exit code ${exitCode}`);
    }

    const reader = proc.stdout!.getReader();
    const decoder = new TextDecoder();
    let output = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    const firstLine = output.split("\n")[0] || "ffmpeg (unknown version)";
    loggers?.debug?.("[FFmpeg Binary Test]", "✓ Binary available:", firstLine);
    return firstLine;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loggers?.error?.("[FFmpeg Binary Test]", "✗ Binary test failed:", msg);
    throw new Error(`ffmpeg binary not available or not functional: ${msg}`);
  }
};
