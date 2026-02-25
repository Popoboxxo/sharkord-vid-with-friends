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
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bun has global Timer type from timers
type BunTimer = ReturnType<typeof setTimeout>;

// ---- Types ----

export type VideoStreamOptions = {
  inputPath: string;  // Path to temp file or "pipe:0" for stdin
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
};

export type AudioStreamOptions = {
  inputPath: string;  // Path to temp file or "pipe:0" for stdin
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

export type YtDlpDownloadOptions = {
  ytDlpPath: string;
  ffmpegLocation: string;
  sourceUrl: string;
  youtubeUrl?: string;
  streamType: "video" | "audio";
  cookiesPath?: string;
  debug: boolean;
};

export type DebugCacheFileOptions = {
  streamType: "video" | "audio";
  videoId: string;
  now: number;
};

export type SpawnFfmpegOptions = {
  streamType: "video" | "audio";
  sourceUrl: string;
  youtubeUrl?: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
  volume?: number;  // Only for audio
  debugEnabled?: boolean;
  loggers: FfmpegLoggers;
  onEnd?: () => void;
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

/** Build yt-dlp download command for downloading to temp file. (REQ-027-B, REQ-027-C) */
export const buildYtDlpDownloadCmd = (options: YtDlpDownloadOptions & { outputPath: string }): string[] => {
  const {
    ytDlpPath,
    ffmpegLocation,
    sourceUrl,
    youtubeUrl,
    streamType,
    cookiesPath,
    debug,
    outputPath,
  } = options;

  // REQ-002: Progressive download to temp file (stable, no stdout piping bugs)
  const cmd: string[] = [
    ytDlpPath,
    "--no-warnings",
    "--newline",
    "--no-part",                // Don't create .part files
  ];
  
  if (debug) cmd.push("--verbose");
  if (cookiesPath) cmd.push("--cookies", cookiesPath);
  cmd.push("--ffmpeg-location", ffmpegLocation);

  // ALWAYS prefer youtubeUrl over pre-resolved CDN URL
  if (youtubeUrl) {
    const formatSel = streamType === "video"
      ? "bv[vcodec^=avc1][height<=1080]/bv[vcodec^=avc1]/bv*[vcodec^=avc1]"
      : "ba/ba*";
    cmd.push("-f", formatSel, "-o", outputPath, youtubeUrl);
  } else {
    // Fallback: use pre-resolved URL
    cmd.push("-o", outputPath, sourceUrl);
  }

  return cmd;
};

/** Build a debug cache filename for a yt-dlp stream. (REQ-032) */
export const buildDebugCacheFileName = (options: DebugCacheFileOptions): string => {
  const safeId = options.videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `yt-dlp-${options.streamType}-${safeId || "unknown"}-${options.now}.bin`;
};

/** Build a temp file path for yt-dlp downloads. (REQ-002) */
export const buildTempFilePath = (videoId: string, streamType: "video" | "audio"): string => {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
  const timestamp = Date.now();
  const cacheDir = getDebugCacheDir();
  const extension = streamType === "video" ? "mp4" : "webm";
  return path.join(cacheDir, `temp-${streamType}-${safeId}-${timestamp}.${extension}`);
};

const extractYouTubeId = (url: string): string => {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : "";
};

const getDebugCacheDir = (): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
  return path.join(homeDir, ".config", "sharkord", "vid-with-friends-cache");
};

/**
 * Build ffmpeg args for streaming video via RTP directly from a source URL. (REQ-002)
 * Reads the source URL and outputs H264 RTP to Mediasoup.
 * 
 * NOTE: URL is passed via stdin (pipe:0) instead of command-line to avoid
 * buffer overflow in statically-compiled ffmpeg builds with long URLs (>2KB).
 * REQ-026: Workaround for URL length issue in statically-linked ffmpeg.
 *
 * COPY MODE: The input from yt-dlp is already H.264 encoded by YouTube.
 * Re-encoding in real-time causes massive frame drops on limited CPU (Docker).
 * Instead we remux (“copy”) the H.264 directly from the input container (HLS/MPEGTS
 * or DASH/MP4) to RTP. Mediasoup SFU forwards RTP without decoding, so the
 * actual H.264 profile (High/Main/Baseline) doesn't matter for forwarding.
 */
export const buildVideoStreamArgs = (options: VideoStreamOptions): string[] => {
  const { inputPath, rtpHost, rtpPort, payloadType, ssrc } = options;

  // Copy H.264 stream as-is — zero CPU for video, no frame drops.
  // -bsf:v h264_mp4toannexb ensures correct NAL unit format for RTP output
  //   (converts AVCC/length-prefixed from MP4/DASH to Annex B/start-code for RTP;
  //    harmless no-op when input is already MPEGTS/Annex B).
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "warning",
    // Read input at realtime speed to avoid fast playback and early exit
    "-re",
    // Generate timestamps for piped input to keep RTP timing stable
    "-fflags", "+genpts",
    // Input from temp file (grows as yt-dlp downloads)
    "-i", inputPath,
    // Drop audio (separate audio stream handles this)
    "-an",
    // Copy video codec as-is (no re-encoding!)
    "-c:v", "copy",
    // Ensure correct NAL format for RTP
    "-bsf:v", "h264_mp4toannexb",
    // RTP output
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
  const { inputPath, rtpHost, rtpPort, payloadType, ssrc, bitrate, volume } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  const volumeFilter = volume !== 1 ? ["-af", `volume=${volume}`] : [];

  // Audio MUST be re-encoded (AAC → Opus) for Mediasoup/WebRTC compatibility.
  // Unlike video, this is lightweight and doesn't cause frame drops.
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", "warning",
    // Read input at realtime speed to avoid fast playback and early exit
    "-re",
    // Generate timestamps for piped input to keep RTP timing stable
    "-fflags", "+genpts",
    // Probe larger buffer for fragmented MP4 format detection
    "-probesize", "5000000",
    "-analyzeduration", "5000000",
    // Input from temp file (grows as yt-dlp downloads)
    "-i", inputPath,
    // Drop video (separate video stream handles this)
    "-vn",
    // Volume filter
    ...volumeFilter,
    // Opus encoding (required: Mediasoup expects Opus for audio)
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", bitrateNorm,
    "-application", "audio",
    // RTP output
    "-payload_type", String(payloadType),
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpHost}:${rtpPort}?pkt_size=1200`,
  ];
};

// ---- Runtime functions (require ffmpeg binary) ----

/**
 * Spawn an ffmpeg process with yt-dlp download piped to stdin.
 *
 * Downloads YouTube stream via yt-dlp (using YouTube URL + format selection)
 * and pipes it directly to ffmpeg for RTP output. This is more reliable than
 * using pre-resolved CDN URLs which may expire or fail silently.
 *
 * REQ-002, REQ-027-B: Phase logging (DOWNLOADING → PIPING → STREAMING)
 *
 * @param args ffmpeg arguments (from buildVideoStreamArgs/buildAudioStreamArgs)
 * @param loggers Plugin loggers for output
 * @param sourceUrl Pre-resolved CDN URL (fallback if youtubeUrl unavailable)
 * @param youtubeUrl Original YouTube URL — preferred for download (yt-dlp handles auth/retries)
 * @param streamType "video" or "audio" — determines yt-dlp format selection
 * @param onEnd Callback when ffmpeg process exits
 */
/**
 * Spawn ffmpeg process that reads from a temp file (downloaded by yt-dlp in parallel).
 *
 * NEW APPROACH (REQ-002 fix):
 * - yt-dlp downloads to temp file (stable, no stdout piping bugs)
 * - ffmpeg reads from growing temp file (progressive playback)
 * - User sees video immediately (as soon as first chunks arrive)
 * - Cleanup: temp file deleted after stream ends
 *
 * @param args ffmpeg arguments (from buildVideoStreamArgs/buildAudioStreamArgs)
 * @param loggers Plugin loggers for output
 * @param sourceUrl Pre-resolved CDN URL (fallback if youtubeUrl unavailable)
 * @param youtubeUrl Original YouTube URL — preferred for download
 * @param streamType "video" or "audio" — determines yt-dlp format selection
 * @param debugEnabled Enable verbose logging
 * @param onEnd Callback when ffmpeg process exits
 */
export const spawnFfmpeg = (
  args: string[],
  loggers: FfmpegLoggers,
  sourceUrl: string,
  youtubeUrl?: string,
  streamType: "video" | "audio" = "video",
  debugEnabled = false,
  onEnd?: () => void
): SpawnedProcess => {
  const ffmpegPath = getFfmpegPath();
  const binDir = path.dirname(ffmpegPath);
  const ytDlpPath = path.join(binDir, "yt-dlp");
  const cookiesPath = path.join(binDir, "cookies.txt");
  const tag = streamType.toUpperCase(); // "VIDEO" or "AUDIO"

  // Generate temp file path
  const videoId = extractYouTubeId(youtubeUrl || "");
  const tempFilePath = buildTempFilePath(videoId, streamType);
  
  // Ensure cache directory exists
  const cacheDir = path.dirname(tempFilePath);
  mkdirSync(cacheDir, { recursive: true });

  loggers.log(`[${tag}]`, `Phase: DOWNLOADING — yt-dlp downloading to temp file: ${path.basename(tempFilePath)}`);

  // Build yt-dlp download command (downloads to temp file)
  const ytDlpCmd = buildYtDlpDownloadCmd({
    ytDlpPath,
    ffmpegLocation: binDir,
    sourceUrl,
    youtubeUrl,
    streamType,
    cookiesPath: existsSync(cookiesPath) ? cookiesPath : undefined,
    debug: debugEnabled,
    outputPath: tempFilePath,
  });

  if (existsSync(cookiesPath)) {
    loggers.debug(`[${tag}]`, "Using cookies file for download");
  }

  if (youtubeUrl) {
    const formatSel = streamType === "video"
      ? "bv[vcodec^=avc1][height<=1080]/bv[vcodec^=avc1]/bv*[vcodec^=avc1]"
      : "ba/ba*";
    loggers.log(`[${tag}]`, `Downloading via YouTube URL (format: ${formatSel})`);
  } else {
    loggers.log(`[${tag}]`, `Fallback: downloading from CDN URL (${sourceUrl.length} chars)`);
  }

  if (debugEnabled) {
    loggers.debug(`[${tag}]`, "[yt-dlp cmd full]", ytDlpCmd.join(" "));
  } else {
    loggers.debug(`[${tag}]`, "[yt-dlp cmd]", ytDlpCmd.slice(0, 5).join(" ") + " ... " + ytDlpCmd.slice(-1)[0]?.substring(0, 60));
  }
  loggers.debug(`[${tag}]`, "[FFmpeg cmd]", ffmpegPath, ...args);

  // Start yt-dlp to download to temp file
  const ytDlpProc = Bun.spawn({
    cmd: ytDlpCmd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  loggers.debug(`[${tag}]`, `[yt-dlp] Process started (PID: ${ytDlpProc.pid})`);

  // Capture yt-dlp stderr for logging (REQ-027-B)
  (async () => {
    if (!ytDlpProc.stderr) return;
    const reader = (ytDlpProc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (lineBuffer.trim()) loggers.debug(`[${tag}]`, "[yt-dlp]", lineBuffer.trim());
          break;
        }
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();
          if (line) loggers.debug(`[${tag}]`, "[yt-dlp]", line);
        }
        lineBuffer = lines[lines.length - 1] ?? "";
      }
    } catch { /* ignore */ }
    finally { try { reader.releaseLock(); } catch { /* */ } }
  })();

  // Monitor yt-dlp exit — critical for diagnosing download failures (REQ-027-B)
  ytDlpProc.exited.then((code) => {
    if (code !== 0) {
      loggers.error(`[${tag}]`, `[yt-dlp] FAILED (exit code ${code}) — download did not complete!`);
    } else {
      loggers.log(`[${tag}]`, "[yt-dlp] Download completed successfully (exit 0)");
    }
  });

  // Wait for temp file to exist and have some data before starting ffmpeg
  const waitForFile = async () => {
    let retries = 0;
    while (retries < 100) {  // 10 seconds max wait
      if (existsSync(tempFilePath)) {
        const stat = await Bun.file(tempFilePath).size;
        if (stat > 10000) {  // Wait for at least 10KB
          loggers.log(`[${tag}]`, `Temp file ready (${Math.round(stat / 1024)} KB), starting ffmpeg...`);
          return true;
        }
      }
      await new Promise<void>(r => setTimeout(r, 100));
      retries++;
    }
    loggers.error(`[${tag}]`, `Temp file not ready after 10s! yt-dlp may have failed.`);
    return false;
  };

  // Start ffmpeg once temp file is ready
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  const startFfmpeg = async () => {
    const ready = await waitForFile();
    if (!ready) {
      onEnd?.();
      return;
    }

    loggers.log(`[${tag}]`, "Phase: STREAMING — ffmpeg reading from temp file...");

    proc = Bun.spawn({
      cmd: [ffmpegPath, ...args],
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",  // No piping needed — ffmpeg reads from file
    });

    loggers.log(`[${tag}]`, `[FFmpeg] Process started (PID: ${proc.pid})`);

    let stderrDrained = false;
    let firstOutputLogged = false;

    // Forward ffmpeg stderr to plugin logger
    (async () => {
      if (!proc?.stderr) {
        stderrDrained = true;
        loggers.debug(`[${tag}]`, "[FFmpeg] No stderr pipe available");
        return;
      }
      
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let droppedFrameCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (lineBuffer) loggers.debug(`[${tag}]`, "[FFmpeg]", lineBuffer);
            break;
          }
          
          const text = decoder.decode(value, { stream: true });

          // Log the STREAMING phase on first output (REQ-027-B)
          if (!firstOutputLogged) {
            firstOutputLogged = true;
            loggers.log(`[${tag}]`, "Phase: RTP OUTPUT — ffmpeg producing RTP packets");
          }
          
          // Accumulate text and log by line (with spam filtering)
          lineBuffer += text;
          const lines = lineBuffer.split("\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i]!.trim();
            if (line) {
              // Filter out repetitive frame-drop messages to avoid log spam
              if (line.includes("dropping frame") || line.includes("Past duration")) {
                droppedFrameCount++;
                if (droppedFrameCount === 1 || droppedFrameCount % 100 === 0) {
                  loggers.debug(`[${tag}]`, "[FFmpeg]", `${line} (total dropped: ${droppedFrameCount})`);
                }
                continue;
              }
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
        if (droppedFrameCount > 0) {
          loggers.log(`[${tag}]`, `[FFmpeg] Total dropped frames during session: ${droppedFrameCount}`);
        }
        loggers.debug(`[${tag}]`, "[FFmpeg] Stderr stream closed");
      }
    })();

    proc.exited.then(async (exitCode) => {
      // Wait for stderr to be fully drained
      let waitCount = 0;
      while (!stderrDrained && waitCount < 100) {
        await new Promise<void>((r) => setTimeout(r, 10));
        waitCount++;
      }
      
      if (exitCode === 0) {
        loggers.log(`[${tag}]`, "[FFmpeg] ✓ Exited normally (code 0)");
      } else if (exitCode === null) {
        loggers.error(`[${tag}]`, "[FFmpeg] ✗ Killed by signal (SIGSEGV/SIGABRT)");
      } else if (exitCode === 139) {
        loggers.error(`[${tag}]`, "[FFmpeg] ✗ Segmentation Fault (exit 139)");
      } else {
        loggers.error(`[${tag}]`, `[FFmpeg] ✗ Exited with error code ${exitCode}`);
      }
      
      // Cleanup temp file
      try {
        if (existsSync(tempFilePath)) {
          await Bun.write(tempFilePath.replace(/\.(mp4|webm)$/, ".cached.$1"), await Bun.file(tempFilePath).arrayBuffer());
          // Delete temp file (keep cached version for debugging)
          loggers.debug(`[${tag}]`, `Temp file moved to cache: ${path.basename(tempFilePath)}`);
        }
      } catch (err) {
        loggers.error(`[${tag}]`, "Failed to cleanup temp file:", err);
      }
      
      onEnd?.();
    });
  };

  // Start ffmpeg asynchronously
  void startFfmpeg();

  // Return kill function (dummy proc until ffmpeg starts)
  return {
    process: proc as unknown as ReturnType<typeof Bun.spawn>,
    kill() {
      try {
        if (proc) proc.kill("SIGTERM");
        ytDlpProc.kill("SIGTERM");
        loggers.debug(`[${tag}]`, "[Kill] SIGTERM sent to ffmpeg + yt-dlp");
        
        // Cleanup temp file on kill
        if (existsSync(tempFilePath)) {
          try {
            Bun.file(tempFilePath).writer().end();
            loggers.debug(`[${tag}]`, `Temp file cleaned up: ${path.basename(tempFilePath)}`);
          } catch { /* ignore */ }
        }
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
