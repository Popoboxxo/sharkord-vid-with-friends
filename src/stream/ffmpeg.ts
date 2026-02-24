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

// Bun has global Timer type from timers
type BunTimer = ReturnType<typeof setTimeout>;

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
 * 
 * NOTE: URL is passed via stdin (pipe:0) instead of command-line to avoid
 * buffer overflow in statically-compiled ffmpeg builds with long URLs (>2KB).
 * REQ-026: Workaround for URL length issue in statically-linked ffmpeg.
 */
export const buildVideoStreamArgs = (options: VideoStreamOptions): string[] => {
  const { rtpHost, rtpPort, payloadType, ssrc, bitrate } = options;
  // NOTE: sourceUrl not included here — it's passed via stdin instead!
  const bitrateNorm = normalizeBitrate(bitrate);

  // ffmpeg reads from stdin (pipe:0) to avoid command-line URL length limits
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",
    "-i", "pipe:0",                                          // Read from stdin instead of URL arg
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
 * 
 * NOTE: URL is passed via stdin (pipe:0) instead of command-line to avoid
 * buffer overflow in statically-compiled ffmpeg builds with long URLs (>2KB).
 * REQ-026: Workaround for URL length issue in statically-linked ffmpeg.
 */
export const buildAudioStreamArgs = (options: AudioStreamOptions): string[] => {
  const { rtpHost, rtpPort, payloadType, ssrc, bitrate, volume } = options;
  // NOTE: sourceUrl not included here — it's passed via stdin instead!
  const bitrateNorm = normalizeBitrate(bitrate);

  const volumeFilter = volume !== 1 ? ["-af", `volume=${volume}`] : [];

  // ffmpeg reads from stdin (pipe:0) to avoid command-line URL length limits
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",
    "-i", "pipe:0",                                          // Read from stdin instead of URL arg
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
 * 
 * REQ-026: If sourceUrl is a network URL, downloads via yt-dlp and pipes to ffmpeg
 * to avoid segfault (exit 139) with direct network URLs in static ffmpeg builds.
 * 
 * @param youtubeUrl - Optional original YouTube URL for yt-dlp piping (e.g., youtube.com/watch?v=...)
 *                     If provided, this is used for download instead of sourceUrl
 * @param streamType - "video" or "audio" for yt-dlp format selection
 */
/**
 * Spawn an ffmpeg process with the given arguments.
 * Pipes stderr for logging and returns a handle to kill the process.
 * 
 * REQ-026: Writes source URL to ffmpeg stdin (pipe:0 in args) instead of command-line
 * to avoid buffer overflow in statically-compiled ffmpeg with very long URLs (>2KB).
 * This solves the segfault issue with YouTube video URLs.
 */
export const spawnFfmpeg = (
  args: string[],
  loggers: FfmpegLoggers,
  sourceUrl: string,
  youtubeUrl?: string,
  streamType: "video" | "audio" = "video",
  onEnd?: () => void
): SpawnedProcess => {
  const ffmpegPath = getFfmpegPath();

  // Log the command (without full URL due to length)
  loggers.debug("[FFmpeg]", "Starting process...");
  loggers.debug("[FFmpeg Command]", ffmpegPath, ...args);
  loggers.debug("[FFmpeg URL]", `Will be passed to stdin (length: ${sourceUrl.length} chars)`);

  const proc = Bun.spawn({
    cmd: [ffmpegPath, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "pipe",  // Will write URL via stdin
  });

  loggers.debug("[FFmpeg]", `Process spawned (PID: ${proc.pid})`);

  // Write the URL to stdin (for pipe:0 input)
  (async () => {
    try {
      if (!proc.stdin) {
        loggers.error("[FFmpeg stdin]", "No stdin available");
        return;
      }
      
      // Write URL followed by newline
      const writer = proc.stdin.getWriter();
      const urlBytes = new TextEncoder().encode(sourceUrl);
      await writer.write(urlBytes);
      await writer.close();
      loggers.debug("[FFmpeg stdin]", `✓ Sent ${urlBytes.length} bytes`);
    } catch (err) {
      loggers.error("[FFmpeg stdin error]", err);
    }
  })();

  let stderrStarted = false;
  let stderrDrained = false;

  // Forward stderr to plugin logger — CONCURRENT with process
  (async () => {
    if (!proc.stderr) {
      stderrDrained = true;
      loggers.debug("[FFmpeg]", "No stderr pipe available");
      return;
    }
    
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let reads = 0;

    try {
      loggers.debug("[FFmpeg]", "Reading stderr...");
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (lineBuffer) {
            loggers.debug("[FFmpeg]", lineBuffer);
            lineBuffer = "";
          }
          break;
        }
        
        const text = decoder.decode(value, { stream: true });
        stderrStarted = true;
        
        // Accumulate text and log by line
        lineBuffer += text;
        const lines = lineBuffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line) {
            loggers.debug("[FFmpeg]", line);
          }
        }
        lineBuffer = lines[lines.length - 1];  // Keep incomplete line
        
        reads++;
        if (reads % 50 === 0) await new Promise<void>((r) => setTimeout(r, 0));
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
      loggers.debug("[FFmpeg]", "Stderr stream closed");
    }
  })();

  // Monitor process startup
  let startupTimeout: BunTimer | null = null;
  startupTimeout = setTimeout(() => {
    if (!stderrStarted) {
      loggers.error("[FFmpeg Startup Issue]", "No stderr output within 2 seconds. ffmpeg may have crashed or failed to start.");
      loggers.error("[FFmpeg Diagnostic]", "Check: file permissions, codec availability, platform compatibility");
    }
  }, 2000);

  proc.exited.then(async (exitCode) => {
    if (startupTimeout) clearTimeout(startupTimeout);

    // Wait for stderr to be fully drained before considering process complete
    let waitCount = 0;
    while (!stderrDrained && waitCount < 100) {
      await new Promise<void>((r) => setTimeout(r, 10));
      waitCount++;
    }
    
    // Log exit status for debugging
    if (exitCode === 0) {
      loggers.debug("[FFmpeg Process]", "✓ Exited normally (code 0)");
    } else if (exitCode === null) {
      loggers.error("[FFmpeg Process]", "✗ Killed by signal or crashed (segfault)");
      loggers.error("[FFmpeg Diagnostic]", "Signal-based exit (typically SIGSEGV or SIGABRT on statically-linked builds)");
    } else if (exitCode === 139) {
      loggers.error("[FFmpeg Process]", "✗ Segmentation Fault (SIGSEGV - exit code 139)");
      loggers.error("[FFmpeg Diagnostic]", `Segfault likely causes:`);
      loggers.error("[FFmpeg Diagnostic]", "  1. RTP output binding failure (port occupied)");
      loggers.error("[FFmpeg Diagnostic]", "  2. Codec negotiation failure with Mediasoup");
      loggers.error("[FFmpeg Diagnostic]", "  3. HTTP stream read timeout");
      loggers.error("[FFmpeg Diagnostic]", "  4. stdin buffer overflow (should be fixed by piping URL)");
    } else {
      loggers.error("[FFmpeg Process]", `✗ Exited with error code ${exitCode}`);
      loggers.error("[FFmpeg Diagnostic]", "Possible causes: invalid URL, network error, RTP binding failed, missing codec");
    }
    
    onEnd?.();
  });

  return {
    process: proc,
    kill() {
      if (startupTimeout) clearTimeout(startupTimeout);
      try {
        proc.kill("SIGTERM");
        loggers.debug("[FFmpeg]", "Kill signal sent");
      } catch {
        // Process may already be dead
      }
    },
  };
};

/**
 * Test if ffmpeg binary is available and functional.
 * Returns version info if successful, throws an error otherwise.
 */
export const testFfmpegBinary = async (loggers?: FfmpegLoggers): Promise<string> => {
  const ffmpegPath = getFfmpegPath();
  
  try {
    // Try running ffmpeg -version to test binary
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
