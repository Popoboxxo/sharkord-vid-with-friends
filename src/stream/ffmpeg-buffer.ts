/**
 * Buffer / download wait logic for progressive and complete download modes.
 */

import { existsSync, unlinkSync } from "fs";
import { shouldRetryWithoutFormatId, shouldRetryWithCdnUrl } from "./ffmpeg-utils";
import { retryYtDlpWithoutFormatId, retryYtDlpWithCdnUrl, type YtDlpDownloadState } from "./ffmpeg-download";
import type { FfmpegLoggers } from "./ffmpeg-types";

export async function waitForCompleteDownload(options: {
  state: YtDlpDownloadState;
  tempFilePath: string;
  preferredFormatId: string | undefined;
  tag: string;
  loggers: FfmpegLoggers;
  notifyReadyForSyncStart?: () => void;
  waitForSyncStartSignal?: Promise<void>;
  cleanup: () => void;
  ytDlpPath: string;
  binDir: string;
  sourceUrl: string;
  youtubeUrl?: string;
  streamType: "video" | "audio";
  debugEnabled: boolean;
  videoId: string;
}): Promise<void> {
  const {
    state, tempFilePath, preferredFormatId, tag, loggers,
    notifyReadyForSyncStart, waitForSyncStartSignal, cleanup,
    ytDlpPath, binDir, sourceUrl, youtubeUrl, streamType, debugEnabled, videoId,
  } = options;

  loggers.log(`[${tag}]`, "Waiting for full download before starting ffmpeg...");
  let code = await (state.exit as Promise<number>);
  if (code !== 0 && code !== 143) {
    const shouldRetry = shouldRetryWithoutFormatId(code, state.stderrText, preferredFormatId);
    if (shouldRetry) {
      await retryYtDlpWithoutFormatId(state, { tempFilePath, ytDlpPath, binDir, sourceUrl, youtubeUrl, streamType, debugEnabled, videoId, loggers, tag });
      code = await (state.exit as Promise<number>);
    }
  }
  if (code !== 0 && code !== 143) {
    const shouldRetryCdn = shouldRetryWithCdnUrl(code, state.stderrText, sourceUrl, youtubeUrl);
    if (shouldRetryCdn) {
      await retryYtDlpWithCdnUrl(state, { tempFilePath, ytDlpPath, binDir, sourceUrl, streamType, debugEnabled, videoId, loggers, tag });
      code = await (state.exit as Promise<number>);
    }
  }
  if (code !== 0 && code !== 143) {
    cleanup();
    throw new Error(`${tag}: yt-dlp failed — exit ${code}`);
  }
  loggers.log(`[${tag}]`, "Download complete, starting ffmpeg...");
  if (notifyReadyForSyncStart) {
    notifyReadyForSyncStart();
  }
  if (waitForSyncStartSignal) {
    loggers.log(`[${tag}]`, "Waiting for synchronized track start signal...");
    const startSyncResult = await Promise.race([
      waitForSyncStartSignal.then(() => "ready" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
    ]);
    if (startSyncResult === "timeout") {
      loggers.error(`[${tag}]`, "Synchronized start wait timed out; starting track anyway.");
    }
  }
}

export async function waitForProgressiveBuffer(options: {
  state: YtDlpDownloadState;
  tempFilePath: string;
  streamType: "video" | "audio";
  tag: string;
  loggers: FfmpegLoggers;
  notifyReadyForSyncStart?: () => void;
  waitForSyncStartSignal?: Promise<void>;
  cleanup: () => void;
  onPhaseChange?: (phase: "DOWNLOADING" | "BUFFERING" | "STREAMING") => void;
  ytDlpPath: string;
  binDir: string;
  sourceUrl: string;
  youtubeUrl?: string;
  preferredFormatId: string | undefined;
  debugEnabled: boolean;
  videoId: string;
}): Promise<void> {
  const {
    state, tempFilePath, streamType, tag, loggers,
    notifyReadyForSyncStart, waitForSyncStartSignal, cleanup, onPhaseChange,
    ytDlpPath, binDir, sourceUrl, youtubeUrl, preferredFormatId, debugEnabled, videoId,
  } = options;

  const minInitialBytes = streamType === "video" ? 10_000_000 : 100_000;
  loggers.log(`[${tag}]`, "Waiting for initial buffer...");
  let fileReady = false;

  for (let i = 0; i < 300; i++) {
    if (existsSync(tempFilePath)) {
      const fileSize = Bun.file(tempFilePath).size;
      if (fileSize >= minInitialBytes) {
        loggers.log(`[${tag}]`, `Temp file ready (${Math.round(fileSize / 1024)} KB), starting ffmpeg...`);
        onPhaseChange?.("BUFFERING");
        fileReady = true;
        break;
      }
    }
    if (state.exitCode !== null && state.exitCode !== 0 && state.exitCode !== 143) {
      loggers.log(`[${tag}]`, `[yt-dlp] Exited with code ${state.exitCode} — aborting buffer wait early`);
      break;
    }
    await new Promise<void>(r => setTimeout(r, 100));
  }

  if (!fileReady) {
    const shouldRetry = shouldRetryWithoutFormatId(state.exitCode, state.stderrText, preferredFormatId);
    if (shouldRetry) {
      await retryYtDlpWithoutFormatId(state, { tempFilePath, ytDlpPath, binDir, sourceUrl, youtubeUrl, streamType, debugEnabled, videoId, loggers, tag });
      loggers.log(`[${tag}]`, "Retry download started, waiting again for initial buffer...");
      for (let i = 0; i < 300; i++) {
        if (existsSync(tempFilePath)) {
          const fileSize = Bun.file(tempFilePath).size;
          if (fileSize >= minInitialBytes) {
            loggers.log(`[${tag}]`, `Temp file ready after retry (${Math.round(fileSize / 1024)} KB), starting ffmpeg...`);
            onPhaseChange?.("BUFFERING");
            fileReady = true;
            break;
          }
        }
        if (state.exitCode !== null && state.exitCode !== 0 && state.exitCode !== 143) {
          loggers.log(`[${tag}]`, `[yt-dlp] Exited with code ${state.exitCode} — aborting buffer wait early`);
          break;
        }
        await new Promise<void>(r => setTimeout(r, 100));
      }
    }
  }

  if (!fileReady) {
    const shouldRetryCdn = shouldRetryWithCdnUrl(state.exitCode, state.stderrText, sourceUrl, youtubeUrl);
    if (shouldRetryCdn) {
      await retryYtDlpWithCdnUrl(state, { tempFilePath, ytDlpPath, binDir, sourceUrl, streamType, debugEnabled, videoId, loggers, tag });
      loggers.log(`[${tag}]`, "[CDN fallback] Retry started, waiting for initial buffer...");
      for (let i = 0; i < 300; i++) {
        if (existsSync(tempFilePath)) {
          const fileSize = Bun.file(tempFilePath).size;
          if (fileSize >= minInitialBytes) {
            loggers.log(`[${tag}]`, `Temp file ready after CDN fallback (${Math.round(fileSize / 1024)} KB), starting ffmpeg...`);
            onPhaseChange?.("BUFFERING");
            fileReady = true;
            break;
          }
        }
        if (state.exitCode !== null && state.exitCode !== 0 && state.exitCode !== 143) {
          loggers.log(`[${tag}]`, `[yt-dlp] Exited with code ${state.exitCode} — aborting buffer wait early`);
          break;
        }
        await new Promise<void>(r => setTimeout(r, 100));
      }
    }
  }

  if (!fileReady) {
    loggers.error(`[${tag}]`, `Temp file not ready after 30s! yt-dlp may have failed.`);
    try { (state.proc as ReturnType<typeof Bun.spawn> | null)?.kill("SIGTERM"); } catch { /* */ }
    cleanup();
    throw new Error(`${tag}: yt-dlp download failed — no data received after 30s`);
  }

  if (state.proc !== null && state.exitCode === null && state.exit !== null) {
    loggers.log(`[${tag}]`, "[yt-dlp] Waiting for download to complete before starting ffmpeg (max 120s)...");
    const ytDlpResult = await Promise.race([
      (state.exit as Promise<number>).then((code: number) => ({ status: "done" as const, code })),
      new Promise<{ status: "timeout" }>((resolve) => setTimeout(() => resolve({ status: "timeout" }), 120_000)),
    ]);
    if (ytDlpResult.status === "timeout") {
      loggers.error(`[${tag}]`, "[yt-dlp] Download wait timed out after 120s — starting ffmpeg on partial file.");
    } else if (ytDlpResult.code !== 0 && ytDlpResult.code !== 143) {
      loggers.error(`[${tag}]`, `[yt-dlp] Download ended with error code ${ytDlpResult.code} — attempting ffmpeg on partial file.`);
    } else {
      await Bun.sleep(200);
      try {
        const finalFileSize = existsSync(tempFilePath) ? Bun.file(tempFilePath).size : 0;
        loggers.log(`[${tag}]`, `[yt-dlp] Download confirmed complete — final file size: ${Math.round(finalFileSize / 1024)} KB`);
      } catch {
        loggers.log(`[${tag}]`, "[yt-dlp] Download confirmed complete");
      }
    }
  } else {
    loggers.log(`[${tag}]`, "[yt-dlp] Download already complete when ffmpeg starts.");
  }

  if (notifyReadyForSyncStart) {
    notifyReadyForSyncStart();
  }
  if (waitForSyncStartSignal) {
    loggers.log(`[${tag}]`, "Waiting for synchronized track start signal...");
    const startSyncResult = await Promise.race([
      waitForSyncStartSignal.then(() => "ready" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
    ]);
    if (startSyncResult === "timeout") {
      loggers.error(`[${tag}]`, "Synchronized start wait timed out; starting track anyway.");
    }
  }
}
