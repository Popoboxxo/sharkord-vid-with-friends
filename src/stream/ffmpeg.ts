/**
 * ffmpeg wrapper — spawns ffmpeg processes for HLS buffering and RTP streaming.
 *
 * Provides pure functions for building command arguments (testable)
 * and runtime functions for spawning processes.
 *
 * Referenced by: REQ-002, REQ-003, REQ-012
 */
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Types ----

export type VideoStreamOptions = {
  sourceUrl: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
};

export type AudioStreamOptions = {
  sourceUrl: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
  volume: number;
};

export type FfmpegLoggers = {
  log: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
  debug: (...messages: unknown[]) => void;
};

export type SpawnedProcess = {
  process: ReturnType<typeof Bun.spawn>;
  kill: () => void;
};

// ---- Pure functions (testable without ffmpeg binary) ----

/** Get the platform-appropriate ffmpeg binary name. */
export const getFfmpegBinaryName = (): string =>
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

/** Get the full path to the ffmpeg binary in the plugin's bin/ directory. */
export const getFfmpegPath = (): string =>
  path.join(__dirname, "bin", getFfmpegBinaryName());

/**
 * Normalize a user-provided volume (0-100) to a 0-1 float. (REQ-012)
 * Clamps to valid range.
 */
export const normalizeVolume = (volume: number): number =>
  Math.min(1, Math.max(0, volume / 100));

/**
 * Normalize a bitrate string to a consistent format.
 * Accepts "128k", "128K", "128", returns normalized form.
 */
export const normalizeBitrate = (bitrate?: string): string => {
  if (!bitrate) return "192k";
  const trimmed = bitrate.trim();
  if (!trimmed) return "192k";
  if (/^\d+(?:\.\d+)?k$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return "192k";
};

/**
 * Build ffmpeg args for streaming video via RTP directly from a source URL. (REQ-002)
 * Reads the source URL and outputs H264 RTP to Mediasoup.
 */
export const buildVideoStreamArgs = (options: VideoStreamOptions): string[] => {
  const { sourceUrl, rtpHost, rtpPort, payloadType, ssrc, bitrate } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",    // ← VERBOSE für besseres debugging
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-re",
    "-i", sourceUrl,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-b:v", bitrateNorm,
    "-maxrate", bitrateNorm,
    "-bufsize", `${parseInt(bitrateNorm) * 2 || 4000}k`,
    "-pix_fmt", "yuv420p",
    "-payload_type", String(payloadType),
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpHost}:${rtpPort}?pkt_size=1200`,
  ];
};

/**
 * Build ffmpeg args for streaming audio via RTP directly from a source URL. (REQ-002, REQ-012)
 * Reads the source URL and outputs Opus RTP to Mediasoup.
 */
export const buildAudioStreamArgs = (options: AudioStreamOptions): string[] => {
  const { sourceUrl, rtpHost, rtpPort, payloadType, ssrc, bitrate, volume } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  const volumeFilter = volume !== 1 ? ["-af", `volume=${volume}`] : [];

  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",    // ← VERBOSE für besseres debugging
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-re",
    "-i", sourceUrl,
    "-vn",
    ...volumeFilter,
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", bitrateNorm,
    "-application", "audio",
    "-payload_type", String(payloadType),
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpHost}:${rtpPort}?pkt_size=1200`,
  ];
};

// ---- Runtime functions (require ffmpeg binary) ----

/**
 * Spawn an ffmpeg process with the given arguments.
 * Pipes stderr for logging and returns a handle to kill the process.
 */
export const spawnFfmpeg = (
  args: string[],
  loggers: FfmpegLoggers,
  onEnd?: () => void
): SpawnedProcess => {
  const ffmpegPath = getFfmpegPath();

  // Log the full command for debugging
  loggers.debug("[FFmpeg Command]", ffmpegPath, ...args);

  const proc = Bun.spawn({
    cmd: [ffmpegPath, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Forward stderr to plugin logger — CONCURRENT with process
  // Also wait for all stderr to drain OR process exit, whichever comes first
  let stderrDrained = false;
  (async () => {
    if (!proc.stderr) {
      stderrDrained = true;
      return;
    }
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let reads = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.trim()) loggers.error("[FFmpeg]", text.trim());
        reads++;
        if (reads % 25 === 0) await new Promise<void>((r) => setTimeout(r, 0));
      }
    } catch (err) {
      loggers.error("[FFmpeg stderr error]", err);
    } finally {
      stderrDrained = true;
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  })();

  proc.exited.then(async () => {
    // Wait for stderr to be fully drained before considering process complete
    // (Race condition fix: if ffmpeg exits fast, we want to see the errors)
    let waitCount = 0;
    while (!stderrDrained && waitCount < 100) {
      await new Promise<void>((r) => setTimeout(r, 10));
      waitCount++;
    }
    onEnd?.();
  });

  return {
    process: proc,
    kill() {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
    },
  };
};

/**
 * Kill an ffmpeg process gracefully.
 */
export const killProcess = (spawned: SpawnedProcess | null): void => {
  if (!spawned) return;
  spawned.kill();
};
