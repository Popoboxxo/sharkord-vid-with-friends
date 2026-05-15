/**
 * ffmpeg process launch and stderr parsing.
 */

import { parseFfmpegDurationToSeconds, parseProgressTimeToSeconds } from "./ffmpeg-utils";
import type { FfmpegLoggers, SpawnedProcess } from "./ffmpeg-types";

export function launchFfmpegStream(options: {
  ffmpegPath: string;
  args: string[];
  tag: string;
  loggers: FfmpegLoggers;
  debugEnabled: boolean;
  fullDownloadModePassed: boolean;
  onProgressTimeSeconds?: (seconds: number) => void;
  expectedDurationSeconds?: number;
  onPhaseChange?: (phase: "DOWNLOADING" | "BUFFERING" | "STREAMING") => void;
  onEnd?: () => void;
  cleanup: () => void;
  ytDlpProc: ReturnType<typeof Bun.spawn> | null;
}): SpawnedProcess {
  const {
    ffmpegPath, args, tag, loggers, debugEnabled, fullDownloadModePassed,
    onProgressTimeSeconds, expectedDurationSeconds, onPhaseChange, onEnd,
    cleanup, ytDlpProc,
  } = options;

  if (debugEnabled) {
    if (fullDownloadModePassed) {
      loggers.debug(`[${tag}]`, "[av-sync] Full-download mode: vsync=0, avoid_negative_ts=make_zero, async=1 active");
    } else {
      loggers.debug(`[${tag}]`, "[av-sync] Streaming mode: vsync=cfr, async=1, max_muxing_queue_size=9999 active");
    }
    loggers.debug(`[${tag}]`, "[FFmpeg cmd]", ffmpegPath, ...args);
  }

  const proc = Bun.spawn({
    cmd: [ffmpegPath, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  loggers.log(`[${tag}]`, `[FFmpeg] Process started (PID: ${proc.pid})`);

  let stderrDrained = false;
  let firstOutputLogged = false;
  let lastProgressLog = 0;
  let lastReportedPtsSeconds = 0;

  (async () => {
    if (!proc.stderr) {
      stderrDrained = true;
      return;
    }

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let droppedFrameCount = 0;
    let totalFrames = 0;
    let ffmpegInputDurationSeconds: number | null = null;
    let streamedDurationSeconds = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (lineBuffer) loggers.debug(`[${tag}]`, "[FFmpeg]", lineBuffer);
          break;
        }

        const text = decoder.decode(value, { stream: true });

        if (!firstOutputLogged) {
          firstOutputLogged = true;
          loggers.log(`[Phase] STREAMING — ffmpeg producing RTP packets, RTP encoder active`);
          onPhaseChange?.("STREAMING");
        }

        lineBuffer += text;
        const lines = lineBuffer.split(/[\r\n]/);
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();
          if (!line) continue;

          const frameMatch = line.match(/frame=\s*(\d+)/);
          const timeMatch = line.match(/time=\s*([\d:.]+)/);
          const speedMatch = line.match(/speed=\s*([\d.]+)/);
          const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*\w+)/);

          if (frameMatch || timeMatch) {
            const now = Date.now();
            if (frameMatch) totalFrames = parseInt(frameMatch[1]!);
            if (timeMatch) {
              const parsedTime = parseProgressTimeToSeconds(timeMatch[1]!);
              if (parsedTime !== null) {
                streamedDurationSeconds = parsedTime;
                lastReportedPtsSeconds = parsedTime;
                onProgressTimeSeconds?.(parsedTime);
              }
            }
            if (now - lastProgressLog >= 3000) {
              lastProgressLog = now;
              const parts: string[] = [];
              if (frameMatch) parts.push(`frame=${frameMatch[1]}`);
              if (timeMatch) parts.push(`time=${timeMatch[1]}`);
              if (speedMatch) parts.push(`speed=${speedMatch[1]}x`);
              if (bitrateMatch) parts.push(`bitrate=${bitrateMatch[1]}`);
              loggers.log(`[${tag}]`, `[FFmpeg Progress] ${parts.join(", ")}`);
            }
            continue;
          }

          if (line.includes("dropping frame") || line.includes("Past duration")) {
            droppedFrameCount++;
            if (droppedFrameCount === 1 || droppedFrameCount % 100 === 0) {
              loggers.debug(`[${tag}]`, "[FFmpeg]", `${line} (total dropped: ${droppedFrameCount})`);
            }
            continue;
          }

          if (ffmpegInputDurationSeconds === null && line.includes("Duration:")) {
            const parsedDuration = parseFfmpegDurationToSeconds(line);
            if (parsedDuration !== null) {
              ffmpegInputDurationSeconds = parsedDuration;
              const lengthBits = [`input=${parsedDuration}s`];
              if (typeof expectedDurationSeconds === "number" && expectedDurationSeconds > 0) {
                lengthBits.push(`expected=${expectedDurationSeconds}s`);
              }
              loggers.log(`[${tag}]`, `[FFmpeg Length] ${lengthBits.join(", ")}`);
            }
          }

          if (line.startsWith("Input") || line.startsWith("Output") || line.startsWith("Stream") || line.includes("encoder") || line.includes("decoder") || line.includes("h264") || line.includes("opus") || line.includes("aac")) {
            loggers.log(`[${tag}]`, "[FFmpeg]", line);
          } else {
            loggers.debug(`[${tag}]`, "[FFmpeg]", line);
          }
        }
        lineBuffer = lines[lines.length - 1] ?? "";
      }
    } catch (err) {
      loggers.error(`[${tag}]`, "[FFmpeg stderr error]", err);
    } finally {
      stderrDrained = true;
      try { reader.releaseLock(); } catch { /* */ }
      const lengthSummary: string[] = [];
      if (typeof expectedDurationSeconds === "number" && expectedDurationSeconds > 0) {
        lengthSummary.push(`expected=${expectedDurationSeconds}s`);
      }
      if (ffmpegInputDurationSeconds !== null) {
        lengthSummary.push(`input=${ffmpegInputDurationSeconds}s`);
      }
      if (streamedDurationSeconds > 0) {
        lengthSummary.push(`streamed=${streamedDurationSeconds}s`);
      }
      if (lengthSummary.length > 0) {
        loggers.log(`[${tag}]`, `[FFmpeg Length] End summary: ${lengthSummary.join(", ")}`);
      }
      loggers.log(`[${tag}]`, `[FFmpeg] Stream ended — total frames: ${totalFrames}, dropped: ${droppedFrameCount}`);
      loggers.debug(`[${tag}]`, "[FFmpeg] Stderr stream closed");
    }
  })();

  let killed = false;

  proc.exited.then(async (exitCode: number) => {
    let waitCount = 0;
    while (!stderrDrained && waitCount < 100) {
      await new Promise<void>((r) => setTimeout(r, 10));
      waitCount++;
    }

    if (exitCode === 0) {
      loggers.log(`[${tag}]`, "[FFmpeg] ✓ Exited normally (code 0)");
    } else if (killed || exitCode === null || exitCode === 137 || exitCode === 255) {
      loggers.debug(`[${tag}]`, `[FFmpeg] Killed/stopped (code ${exitCode})`);
    } else if (exitCode === 139) {
      loggers.error(`[${tag}]`, "[FFmpeg] ✗ Segmentation Fault (exit 139)");
    } else {
      loggers.error(`[${tag}]`, `[FFmpeg] ✗ Exited with error code ${exitCode}`);
    }

    onEnd?.();
  });

  return {
    process: proc,
    getLastPtsSeconds(): number {
      return lastReportedPtsSeconds;
    },
    kill() {
      killed = true;
      try {
        proc.kill("SIGTERM");
        ytDlpProc?.kill("SIGTERM");
        loggers.debug(`[${tag}]`, "[Kill] SIGTERM sent to ffmpeg and optional yt-dlp process");
      } catch {
        // Process may already be dead
      }
    },
  };
}
