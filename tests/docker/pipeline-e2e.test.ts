/**
 * Pipeline E2E Tests — run in Docker:
 *   docker compose -f tests/docker/docker-compose.yml run --rm pipeline-e2e
 *
 * Tests both streaming (progressive) and full-download pipeline modes
 * against a real YouTube video. Asserts that the stream runs for at least
 * 85% of the expected video duration without premature abort.
 *
 * Referenced by: REQ-044
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync, symlinkSync, existsSync } from "fs";
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { resolveVideo } from "../../src/stream/yt-dlp";
import { spawnFfmpeg } from "../../src/stream/ffmpeg";
import type { FfmpegLoggers, SpawnFfmpegOptions } from "../../src/stream/ffmpeg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Configuration ----

const TEST_URL = "https://youtu.be/HrNzO3V7Ob0";
const CACHE_DIR = "/tmp/pipeline-e2e-test";

// Paths provided by Docker environment (tests/docker/docker-compose.yml).
// Outside Docker we intentionally do not force execution of this suite.
const FFMPEG_PATH = process.env.FFMPEG_PATH;
const YT_DLP_PATH = process.env.YT_DLP_PATH;

// Bin directory expected by spawnFfmpeg / resolveVideo (derived from src/stream/ffmpeg.ts)
const SRC_BIN_DIR = path.resolve(__dirname, "../../src/stream/bin");

// ---- Helpers ----

/**
 * Ensure the src/stream/bin directory contains symlinks pointing to the
 * system binaries that are available in the Docker container.
 * This is necessary because spawnFfmpeg and resolveVideo derive their
 * binary paths from getFfmpegPath() / getYtDlpPath() which hard-code
 * the src/stream/bin/ subdirectory.
 */
const ensureBinSymlinks = (): void => {
  if (!FFMPEG_PATH || !YT_DLP_PATH) {
    return;
  }

  mkdirSync(SRC_BIN_DIR, { recursive: true });

  const ffmpegLink = path.join(SRC_BIN_DIR, "ffmpeg");
  if (!existsSync(ffmpegLink)) {
    symlinkSync(FFMPEG_PATH, ffmpegLink);
  }

  const ytDlpLink = path.join(SRC_BIN_DIR, "yt-dlp");
  if (!existsSync(ytDlpLink)) {
    symlinkSync(YT_DLP_PATH, ytDlpLink);
  }
};

const shouldRunPipelineE2E = (): boolean => Boolean(FFMPEG_PATH && YT_DLP_PATH);

/** Build a logger that collects all output and also prints to console. */
const buildLoggers = (tag: string, collected: string[]): FfmpegLoggers => ({
  log: (...messages: unknown[]) => {
    const line = `[test:stream][${tag}] ${messages.join(" ")}`;
    collected.push(line);
    console.log(line);
  },
  debug: (...messages: unknown[]) => {
    const line = `[test:stream][${tag}][debug] ${messages.join(" ")}`;
    collected.push(line);
    console.log(line);
  },
  error: (...messages: unknown[]) => {
    const line = `[test:stream][${tag}][error] ${messages.join(" ")}`;
    collected.push(line);
    console.error(line);
  },
});

/** Parse the latest "time=HH:MM:SS.xx" value from collected log lines. */
const extractStreamedSeconds = (logs: string[]): number => {
  let lastSeconds = 0;
  for (const line of logs) {
    // spawnFfmpeg emits: [FFmpeg Progress] time=HH:MM:SS.xx
    const match = line.match(/time=([\d:.]+)/);
    if (match?.[1]) {
      const parts = match[1].split(":");
      if (parts.length === 3) {
        const h = parseInt(parts[0]!, 10);
        const m = parseInt(parts[1]!, 10);
        const s = parseFloat(parts[2]!);
        const total = h * 3600 + m * 60 + s;
        if (Number.isFinite(total) && total > 0) {
          lastSeconds = total;
        }
      }
    }
  }
  return lastSeconds;
};

// ---- Setup ----

beforeAll(() => {
  ensureBinSymlinks();
  mkdirSync(CACHE_DIR, { recursive: true });
});

// ---- Tests ----

describe("Pipeline E2E", () => {
  it("[REQ-044] Streaming mode: full pipeline should run without premature EOF", async () => {
    if (!shouldRunPipelineE2E()) {
      console.warn("[Pipeline E2E] Skipped: requires FFMPEG_PATH and YT_DLP_PATH (Docker test environment).");
      return;
    }

    const logs: string[] = [];
    const loggers = buildLoggers("streaming", logs);

    loggers.log("Resolving video:", TEST_URL);
    const resolved = await resolveVideo(TEST_URL, loggers);

    expect(resolved.title.length).toBeGreaterThan(0);
    expect(resolved.duration).toBeGreaterThan(0);
    expect(resolved.streamUrl.length + resolved.audioUrl.length).toBeGreaterThan(0);

    loggers.log(
      `Resolved: title="${resolved.title}", duration=${resolved.duration}s,`,
      `videoFormatId=${resolved.videoFormatId || "none"}, audioFormatId=${resolved.audioFormatId || "none"}`
    );

    const expectedSeconds = resolved.duration;
    const testTimeoutMs = expectedSeconds * 3 * 1000 + 120_000;

    // Spawn video stream (streaming mode: fullDownloadMode = false → waitForDownloadComplete = false)
    let videoStreamedSeconds = 0;
    const videoEndPromise = new Promise<void>((resolve) => {
      const opts: SpawnFfmpegOptions = {
        streamType: "video",
        sourceUrl: resolved.streamUrl,
        youtubeUrl: resolved.youtubeUrl,
        formatId: resolved.videoFormatId,
        rtpHost: "127.0.0.1",
        rtpPort: 20010,
        payloadType: 96,
        ssrc: 111000001,
        bitrate: "2000k",
        waitForDownloadComplete: false,
        expectedDurationSeconds: resolved.duration,
        debugEnabled: true,
        loggers,
        onProgressTimeSeconds: (seconds) => { videoStreamedSeconds = seconds; },
        onEnd: resolve,
      };
      spawnFfmpeg(opts).catch((err: unknown) => {
        loggers.error("spawnFfmpeg video error:", String(err));
        resolve();
      });
    });

    // Spawn audio stream (streaming mode: fullDownloadMode = false)
    let audioStreamedSeconds = 0;
    const audioEndPromise = new Promise<void>((resolve) => {
      const opts: SpawnFfmpegOptions = {
        streamType: "audio",
        sourceUrl: resolved.audioUrl,
        youtubeUrl: resolved.youtubeUrl,
        formatId: resolved.audioFormatId,
        rtpHost: "127.0.0.1",
        rtpPort: 20011,
        payloadType: 111,
        ssrc: 112000001,
        bitrate: "128k",
        volume: 1,
        waitForDownloadComplete: false,
        expectedDurationSeconds: resolved.duration,
        debugEnabled: true,
        loggers,
        onProgressTimeSeconds: (seconds) => { audioStreamedSeconds = seconds; },
        onEnd: resolve,
      };
      spawnFfmpeg(opts).catch((err: unknown) => {
        loggers.error("spawnFfmpeg audio error:", String(err));
        resolve();
      });
    });

    // Wait for both streams to finish (or timeout)
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), testTimeoutMs)
    );

    const result = await Promise.race([
      Promise.all([videoEndPromise, audioEndPromise]).then(() => "done" as const),
      timeoutPromise,
    ]);

    if (result === "timeout") {
      loggers.error("Test timed out waiting for stream to finish");
    }

    // Use the larger of parsed-from-logs vs tracked-via-callback
    const streamedSecondsFromLogs = extractStreamedSeconds(logs);
    const streamedSeconds = Math.max(videoStreamedSeconds, audioStreamedSeconds, streamedSecondsFromLogs);
    const minAcceptable = expectedSeconds * 0.85;

    const passed = streamedSeconds >= minAcceptable;
    if (!passed) {
      console.error([
        "",
        "PIPELINE FAILURE — Streaming Mode",
        `Expected: ~${minAcceptable.toFixed(1)}s streamed (85% of ${expectedSeconds}s)`,
        `Actual:    ${streamedSeconds.toFixed(1)}s streamed`,
        "All logs:",
        ...logs,
      ].join("\n"));
    }

    expect(streamedSeconds).toBeGreaterThanOrEqual(minAcceptable);
  }, /* timeout computed at runtime — set a generous static cap */ 1_200_000);

  it("[REQ-044] Full-download mode: full pipeline should run without premature EOF", async () => {
    if (!shouldRunPipelineE2E()) {
      console.warn("[Pipeline E2E] Skipped: requires FFMPEG_PATH and YT_DLP_PATH (Docker test environment).");
      return;
    }

    const logs: string[] = [];
    const loggers = buildLoggers("full-download", logs);

    loggers.log("Resolving video:", TEST_URL);
    const resolved = await resolveVideo(TEST_URL, loggers);

    expect(resolved.title.length).toBeGreaterThan(0);
    expect(resolved.duration).toBeGreaterThan(0);
    expect(resolved.streamUrl.length + resolved.audioUrl.length).toBeGreaterThan(0);

    loggers.log(
      `Resolved: title="${resolved.title}", duration=${resolved.duration}s,`,
      `videoFormatId=${resolved.videoFormatId || "none"}, audioFormatId=${resolved.audioFormatId || "none"}`
    );

    const expectedSeconds = resolved.duration;
    const testTimeoutMs = expectedSeconds * 3 * 1000 + 120_000;

    // Spawn video stream (full-download mode: waitForDownloadComplete = true)
    let videoStreamedSeconds = 0;
    const videoEndPromise = new Promise<void>((resolve) => {
      const opts: SpawnFfmpegOptions = {
        streamType: "video",
        sourceUrl: resolved.streamUrl,
        youtubeUrl: resolved.youtubeUrl,
        formatId: resolved.videoFormatId,
        rtpHost: "127.0.0.1",
        rtpPort: 20012,
        payloadType: 96,
        ssrc: 111000002,
        bitrate: "2000k",
        waitForDownloadComplete: true,
        expectedDurationSeconds: resolved.duration,
        debugEnabled: true,
        loggers,
        onProgressTimeSeconds: (seconds) => { videoStreamedSeconds = seconds; },
        onEnd: resolve,
      };
      spawnFfmpeg(opts).catch((err: unknown) => {
        loggers.error("spawnFfmpeg video error:", String(err));
        resolve();
      });
    });

    // Spawn audio stream (full-download mode: waitForDownloadComplete = true)
    let audioStreamedSeconds = 0;
    const audioEndPromise = new Promise<void>((resolve) => {
      const opts: SpawnFfmpegOptions = {
        streamType: "audio",
        sourceUrl: resolved.audioUrl,
        youtubeUrl: resolved.youtubeUrl,
        formatId: resolved.audioFormatId,
        rtpHost: "127.0.0.1",
        rtpPort: 20013,
        payloadType: 111,
        ssrc: 112000002,
        bitrate: "128k",
        volume: 1,
        waitForDownloadComplete: true,
        expectedDurationSeconds: resolved.duration,
        debugEnabled: true,
        loggers,
        onProgressTimeSeconds: (seconds) => { audioStreamedSeconds = seconds; },
        onEnd: resolve,
      };
      spawnFfmpeg(opts).catch((err: unknown) => {
        loggers.error("spawnFfmpeg audio error:", String(err));
        resolve();
      });
    });

    // Wait for both streams to finish (or timeout)
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), testTimeoutMs)
    );

    const result = await Promise.race([
      Promise.all([videoEndPromise, audioEndPromise]).then(() => "done" as const),
      timeoutPromise,
    ]);

    if (result === "timeout") {
      loggers.error("Test timed out waiting for stream to finish");
    }

    const streamedSecondsFromLogs = extractStreamedSeconds(logs);
    const streamedSeconds = Math.max(videoStreamedSeconds, audioStreamedSeconds, streamedSecondsFromLogs);
    const minAcceptable = expectedSeconds * 0.85;

    const passed = streamedSeconds >= minAcceptable;
    if (!passed) {
      console.error([
        "",
        "PIPELINE FAILURE — Full-Download Mode",
        `Expected: ~${minAcceptable.toFixed(1)}s streamed (85% of ${expectedSeconds}s)`,
        `Actual:    ${streamedSeconds.toFixed(1)}s streamed`,
        "All logs:",
        ...logs,
      ].join("\n"));
    }

    expect(streamedSeconds).toBeGreaterThanOrEqual(minAcceptable);
  }, 1_200_000);
});
