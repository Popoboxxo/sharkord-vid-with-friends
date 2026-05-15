/**
 * yt-dlp download management — spawning, stderr reading, retries, cleanup.
 */

import path from "path";
import { existsSync, unlinkSync } from "fs";
import { shouldCleanupDownloadedData, buildDebugCacheFileName, getDebugCacheDir } from "./ffmpeg-utils";
import { buildYtDlpDownloadCmd } from "./ffmpeg-config";
import type { FfmpegLoggers } from "./ffmpeg-types";

export type YtDlpDownloadState = {
  proc: ReturnType<typeof Bun.spawn> | null;
  exit: Promise<number> | null;
  exitCode: number | null;
  stderrText: string;
};

export function createYtDlpState(): YtDlpDownloadState {
  return { proc: null, exit: null, exitCode: null, stderrText: "" };
}

export function cleanupTempFile(
  tempFilePath: string | undefined,
  debugEnabled: boolean,
  tag: string,
  loggers: FfmpegLoggers
): void {
  if (!shouldCleanupDownloadedData(debugEnabled)) return;
  try {
    if (tempFilePath && existsSync(tempFilePath)) {
      unlinkSync(tempFilePath);
      loggers.debug(`[${tag}]`, `[Cleanup] Removed downloaded temp file: ${path.basename(tempFilePath)}`);
    }
  } catch (err) {
    loggers.debug(`[${tag}]`, `[Cleanup] Could not remove temp file: ${String(err)}`);
  }
}

export async function readYtDlpStderr(
  proc: ReturnType<typeof Bun.spawn>,
  state: YtDlpDownloadState,
  tag: string,
  loggers: FfmpegLoggers
): Promise<void> {
  if (!proc.stderr) return;
  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (lineBuffer.trim()) {
          const finalLine = lineBuffer.trim();
          state.stderrText += `${finalLine}\n`;
          loggers.debug(`[${tag}]`, "[yt-dlp]", finalLine);
        }
        break;
      }
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]!.trim();
        if (!line) continue;
        state.stderrText += `${line}\n`;
        loggers.debug(`[${tag}]`, "[yt-dlp]", line);
      }
      lineBuffer = lines[lines.length - 1] ?? "";
    }
  } catch {
    // ignore stderr reader errors
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
  }
}

export function spawnYtDlpDownload(
  state: YtDlpDownloadState,
  options: {
    ytDlpPath: string;
    binDir: string;
    sourceUrl: string;
    youtubeUrl?: string;
    formatId?: string;
    streamType: "video" | "audio";
    debugEnabled: boolean;
    tempFilePath: string;
    videoId: string;
    loggers: FfmpegLoggers;
    tag: string;
  }
): void {
  const {
    ytDlpPath, binDir, sourceUrl, youtubeUrl, formatId, streamType,
    debugEnabled, tempFilePath, videoId, loggers, tag,
  } = options;

  const effectiveProgressiveVideoMode = streamType === "video" && !formatId;

  const ytDlpCmd = buildYtDlpDownloadCmd({
    ytDlpPath,
    ffmpegLocation: binDir,
    sourceUrl,
    youtubeUrl,
    formatId,
    streamType,
    useMpegTsOutput: effectiveProgressiveVideoMode,
    cookiesPath: existsSync(path.join(binDir, "cookies.txt")) ? path.join(binDir, "cookies.txt") : undefined,
    debug: debugEnabled,
    outputPath: tempFilePath,
  });

  if (youtubeUrl) {
    if (formatId && formatId.trim()) {
      loggers.log(`[${tag}]`, `Downloading via YouTube URL (locked formatId: ${formatId.trim()}${effectiveProgressiveVideoMode ? ", hls-use-mpegts=true" : ""})`);
    } else {
      const formatSel = streamType === "video" ? "bv[vcodec^=avc1][height<=1080]/bv[vcodec^=avc1]/bv*[vcodec^=avc1]" : "ba/ba*";
      loggers.log(`[${tag}]`, `Downloading via YouTube URL (fallback format selection: ${formatSel}${effectiveProgressiveVideoMode ? ", hls-use-mpegts=true" : ""})`);
    }
  } else {
    loggers.log(`[${tag}]`, `Fallback: downloading from CDN URL (${sourceUrl.length} chars)`);
  }

  if (debugEnabled) {
    loggers.debug(`[${tag}]`, "[yt-dlp cmd full]", ytDlpCmd.join(" "));
  }

  state.stderrText = "";
  state.exitCode = null;
  state.proc = Bun.spawn({
    cmd: ytDlpCmd,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  state.exit = state.proc.exited;

  loggers.debug(`[${tag}]`, `[yt-dlp] Process started (PID: ${state.proc.pid})`);

  readYtDlpStderr(state.proc, state, tag, loggers);

  state.exit!.then(async (code: number) => {
    state.exitCode = code;
    if (code !== 0 && code !== 143) {
      loggers.error(`[${tag}]`, `[yt-dlp] FAILED (exit code ${code}) — download did not complete!`);
    } else if (code === 0) {
      try {
        const fileSize = existsSync(tempFilePath) ? Bun.file(tempFilePath).size : 0;
        loggers.log(`[${tag}]`, `[yt-dlp] Download completed (exit 0) — file size: ${Math.round(fileSize / 1024)} KB`);
      } catch {
        loggers.log(`[${tag}]`, "[yt-dlp] Download completed (exit 0)");
      }
      if (debugEnabled && tempFilePath && existsSync(tempFilePath)) {
        const debugFileName = buildDebugCacheFileName({ streamType, videoId, now: Date.now() });
        const debugFilePath = path.join(path.dirname(tempFilePath), debugFileName);
        try {
          await Bun.write(debugFilePath, Bun.file(tempFilePath));
          loggers.debug(`[${tag}]`, `[Debug] Cache copy written: ${debugFileName}`);
        } catch (err) {
          loggers.debug(`[${tag}]`, `[Debug] Could not write cache copy: ${String(err)}`);
        }
      }
    } else {
      loggers.debug(`[${tag}]`, `[yt-dlp] Stopped (exit ${code})`);
    }
  });
}

export async function retryYtDlpWithoutFormatId(
  state: YtDlpDownloadState,
  options: {
    tempFilePath: string;
    ytDlpPath: string;
    binDir: string;
    sourceUrl: string;
    youtubeUrl?: string;
    streamType: "video" | "audio";
    debugEnabled: boolean;
    videoId: string;
    loggers: FfmpegLoggers;
    tag: string;
  }
): Promise<void> {
  const { tempFilePath, ytDlpPath, binDir, sourceUrl, youtubeUrl, streamType, debugEnabled, videoId, loggers, tag } = options;

  loggers.log(`[${tag}]`, "[yt-dlp] Locked format unavailable. Retrying once without formatId lock...");

  try { if (state.proc) state.proc.kill("SIGTERM"); } catch { /* */ }
  try { if (existsSync(tempFilePath)) unlinkSync(tempFilePath); } catch { /* */ }

  spawnYtDlpDownload(state, {
    ytDlpPath, binDir, sourceUrl, youtubeUrl,
    streamType, debugEnabled, tempFilePath, videoId, loggers, tag,
  });
}

export async function retryYtDlpWithCdnUrl(
  state: YtDlpDownloadState,
  options: {
    tempFilePath: string;
    ytDlpPath: string;
    binDir: string;
    sourceUrl: string;
    streamType: "video" | "audio";
    debugEnabled: boolean;
    videoId: string;
    loggers: FfmpegLoggers;
    tag: string;
  }
): Promise<void> {
  const { tempFilePath, ytDlpPath, binDir, sourceUrl, streamType, debugEnabled, videoId, loggers, tag } = options;

  loggers.log(`[${tag}]`, "[yt-dlp] All YouTube format selectors failed (SABR block). Retrying with pre-resolved CDN URL...");

  try { if (state.proc) state.proc.kill("SIGTERM"); } catch { /* */ }
  try { if (existsSync(tempFilePath)) unlinkSync(tempFilePath); } catch { /* */ }

  spawnYtDlpDownload(state, {
    ytDlpPath, binDir, sourceUrl,
    youtubeUrl: undefined,
    streamType, debugEnabled, tempFilePath, videoId, loggers, tag,
  });
}
