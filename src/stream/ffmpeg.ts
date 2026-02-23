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

  // REQ-026: Use stdin pipe instead of direct URL to avoid segfault (exit 139)
  // with network URLs in static ffmpeg builds
  const usePipe = sourceUrl.startsWith("http");

  // Build input args with -re BEFORE -i (it's an input option)
  const inputArgs = usePipe 
    ? ["-re", "-f", "mp4", "-i", "pipe:0"]  // Realtime read from stdin
    : ["-i", sourceUrl];  // Read from file/URL

  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",
    "-protocol_whitelist", "pipe,file,http,https,tcp,tls",
    ...inputArgs,
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

  // REQ-026: Use stdin pipe instead of direct URL to avoid segfault (exit 139)
  const usePipe = sourceUrl.startsWith("http");
  
  // Build input args with -re BEFORE -i (it's an input option)
  const inputArgs = usePipe 
    ? ["-re", "-f", "mp4", "-i", "pipe:0"]  // Realtime read from stdin
    : ["-i", sourceUrl];  // Read from file/URL

  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "verbose",
    "-protocol_whitelist", "pipe,file,http,https,tcp,tls",
    ...inputArgs,
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
export const spawnFfmpeg = (
  args: string[],
  loggers: FfmpegLoggers,
  sourceUrl: string,
  youtubeUrl?: string,
  streamType: "video" | "audio" = "video",
  onEnd?: () => void
): SpawnedProcess => {
  const ffmpegPath = getFfmpegPath();
  const usePipe = sourceUrl.startsWith("http");

  // Log the full command for debugging
  loggers.debug("[FFmpeg Command]", ffmpegPath, ...args);
  if (usePipe) {
    loggers.debug("[FFmpeg Pipe Mode]", `Downloading ${streamType} and piping to ffmpeg stdin`);
  }

  // Spawn download process if using pipe mode (REQ-026)
  // Use original YouTube URL if provided (better for yt-dlp than resolved URLs)
  let downloadProc: any = null;
  if (usePipe) {
    const ytDlpPath = path.join(path.dirname(ffmpegPath), "yt-dlp");
    const downloadUrl = youtubeUrl || sourceUrl;  // Prefer original YouTube URL
    
    // For YouTube URLs: let yt-dlp choose format based on stream type
    // For already-resolved URLs (fallback): direct download
    const isYouTubeUrl = downloadUrl.includes("youtube.com/watch") || downloadUrl.includes("youtu.be/");
    
    let ytDlpArgs: string[];
    if (isYouTubeUrl) {
      // Select best format for the specific stream type
      const formatSelector = streamType === "video" 
        ? "bestvideo[ext=mp4]/bestvideo"  // Best video track
        : "bestaudio[ext=m4a]/bestaudio";  // Best audio track
      ytDlpArgs = [
        "--js-runtimes", "bun",  // Use Bun as JavaScript runtime for YouTube extraction
        "-f", formatSelector, 
        "-o", "-", 
        downloadUrl
      ];
      loggers.debug("[Download] yt-dlp format:", formatSelector);
    } else {
      // Direct download for already-resolved URLs
      ytDlpArgs = ["-o", "-", downloadUrl];
    }
    
    loggers.debug("[Download] yt-dlp:", ytDlpPath, ...ytDlpArgs.slice(0, -1), downloadUrl.substring(0, 80) + "...");
    
    downloadProc = Bun.spawn({
      cmd: [ytDlpPath, ...ytDlpArgs],
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
  }

  const proc = Bun.spawn({
    cmd: [ffmpegPath, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: usePipe ? downloadProc.stdout : "ignore",  // Pipe from download process if available
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

  proc.exited.then(async (exitCode) => {
    // Wait for stderr to be fully drained before considering process complete
    // (Race condition fix: if ffmpeg exits fast, we want to see the errors)
    let waitCount = 0;
    while (!stderrDrained && waitCount < 100) {
      await new Promise<void>((r) => setTimeout(r, 10));
      waitCount++;
    }
    
    // [REQ-026] Log exit status for debugging
    if (exitCode === 0) {
      loggers.debug("[FFmpeg Process]", "Exited normally (code 0)");
    } else if (exitCode === null) {
      loggers.error("[FFmpeg Process]", "Killed by signal or crashed (no exit code)");
    } else {
      loggers.error("[FFmpeg Process]", `Exited with error code ${exitCode}`);
      loggers.error("[FFmpeg Diagnostic]", "Possible causes: invalid URL, network error, RTP binding failed, missing codec, authentication issue");
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
      // Also kill download process if it exists
      if (downloadProc) {
        try {
          downloadProc.kill("SIGTERM");
        } catch {
          // ignore
        }
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
