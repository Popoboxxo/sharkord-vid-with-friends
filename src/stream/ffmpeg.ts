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
  waitForDownloadComplete?: boolean;
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

/** Decide if ffmpeg should wait for a full download before starting. */
export const shouldWaitForDownloadComplete = (streamType: "video" | "audio"): boolean =>
  streamType === "video";

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
  const { inputPath, rtpHost, rtpPort, payloadType, ssrc, bitrate } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  // Re-encode to VP8 with frequent keyframes for WebRTC streaming.
  //
  // WHY VP8 INSTEAD OF H264?
  // H264 over PlainTransport has a fundamental keyframe problem:
  // 1. ffmpeg sends IDR only at the start of the stream
  // 2. If a Mediasoup consumer connects AFTER the IDR, it can't decode
  // 3. PlainTransport + comedia → ffmpeg ignores RTCP (PLI/FIR) → no new IDR
  // 4. Result: consumer stays paused → black screen forever
  //
  // VP8 advantages:
  // - No SPS/PPS negotiation (simpler than H264)
  // - Self-contained keyframes (no decoder state dependency)
  // - Universal browser support via WebRTC
  // - Frequent keyframes with low overhead (-auto-alt-ref 0)
  //
  // Using realtime preset with max speed for Docker CPU constraints.
  return [
    "-hide_banner",
    "-loglevel", "info",
    // Read input at realtime speed
    "-re",
    // Generate timestamps
    "-fflags", "+genpts",
    // Input from temp file
    "-i", inputPath,
    // Drop audio (separate audio stream handles this)
    "-an",
    // VP8 encoding with realtime settings
    "-c:v", "libvpx",
    "-quality", "realtime",
    "-deadline", "realtime",
    "-cpu-used", "8",
    "-b:v", bitrateNorm,
    "-maxrate", bitrateNorm,
    "-bufsize", "2M",
    // Keyframe every 1 second (at 25fps = every 25 frames)
    // Frequent keyframes ensure any late-joining consumer can start within 1s
    "-g", "25",
    "-keyint_min", "25",
    // Disable alternate reference frames (required for RTP streaming)
    "-auto-alt-ref", "0",
    // Error resilience for packet loss
    "-error-resilient", "1",
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
    "-loglevel", "info",
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
 * Spawn ffmpeg process that reads from a temp file (downloaded by yt-dlp in parallel).
 *
 * REQ-002: Stable temp-file streaming approach:
 * - yt-dlp downloads to temp file (no stdout piping bugs)
 * - ffmpeg reads from growing temp file (progressive playback)
 * - User sees video immediately (as soon as first chunks arrive)
 * - Cleanup: temp file retained for debugging
 */
export const spawnFfmpeg = async (options: SpawnFfmpegOptions): Promise<SpawnedProcess> => {
  const {
    streamType,
    sourceUrl,
    youtubeUrl,
    rtpHost,
    rtpPort,
    payloadType,
    ssrc,
    bitrate,
    volume = 1,
    debugEnabled = false,
    waitForDownloadComplete,
    loggers,
    onEnd,
  } = options;

  const ffmpegPath = getFfmpegPath();
  const binDir = path.dirname(ffmpegPath);
  const ytDlpPath = path.join(binDir, "yt-dlp");
  const cookiesPath = path.join(binDir, "cookies.txt");
  const tag = streamType.toUpperCase(); // "VIDEO" or "AUDIO"

  // Generate temp file path
  const videoId = extractYouTubeId(youtubeUrl || "");
  const tempFilePath = buildTempFilePath(videoId, streamType);
  
  // Build ffmpeg args with temp file as input
  const args = streamType === "video"
    ? buildVideoStreamArgs({ inputPath: tempFilePath, rtpHost, rtpPort, payloadType, ssrc, bitrate })
    : buildAudioStreamArgs({ inputPath: tempFilePath, rtpHost, rtpPort, payloadType, ssrc, bitrate, volume });
  
  // Ensure cache directory exists
  const cacheDir = path.dirname(tempFilePath);
  mkdirSync(cacheDir, { recursive: true });

  loggers.log(`[${tag}]`, `Phase: DOWNLOADING — yt-dlp downloading to: ${path.basename(tempFilePath)}`);

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
  }
  loggers.debug(`[${tag}]`, "[FFmpeg cmd]", ffmpegPath, ...args);

  // Start yt-dlp to download to temp file
  const ytDlpProc = Bun.spawn({
    cmd: ytDlpCmd,
    stdout: "ignore",  // yt-dlp writes to file, not stdout
    stderr: "pipe",
    stdin: "ignore",
  });
  const ytDlpExit = ytDlpProc.exited;

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

  // Monitor yt-dlp exit + log final file size
  ytDlpExit.then(async (code) => {
    if (code !== 0 && code !== 143) {  // 143 = SIGTERM (expected on cleanup)
      loggers.error(`[${tag}]`, `[yt-dlp] FAILED (exit code ${code}) — download did not complete!`);
    } else if (code === 0) {
      // Log final file size
      try {
        const fileSize = existsSync(tempFilePath) ? Bun.file(tempFilePath).size : 0;
        loggers.log(`[${tag}]`, `[yt-dlp] Download completed (exit 0) — file size: ${Math.round(fileSize / 1024)} KB`);
      } catch {
        loggers.log(`[${tag}]`, "[yt-dlp] Download completed (exit 0)");
      }
    } else {
      loggers.debug(`[${tag}]`, `[yt-dlp] Stopped (exit ${code})`);
    }
  });

  // Log RTP summary for diagnostics
  loggers.log(`[${tag}]`, `[RTP Config] PT=${options.payloadType}, SSRC=${options.ssrc}, dest=rtp://${rtpHost}:${rtpPort}`);

  const waitForFullDownload = waitForDownloadComplete ?? shouldWaitForDownloadComplete(streamType);
  if (waitForFullDownload) {
    loggers.log(`[${tag}]`, "Waiting for full download before starting ffmpeg...");
    const code = await ytDlpExit;
    if (code !== 0 && code !== 143) {
      throw new Error(`${tag}: yt-dlp failed — exit ${code}`);
    }
  }

  // ---- AWAIT: Wait for temp file to have enough data ----
  loggers.log(`[${tag}]`, "Waiting for download data...");
  let fileReady = false;
  for (let i = 0; i < 300; i++) {  // 30 seconds max wait
    if (existsSync(tempFilePath)) {
      const fileSize = Bun.file(tempFilePath).size;
      if (fileSize > 10000) {  // Wait for at least 10KB
        loggers.log(`[${tag}]`, `Temp file ready (${Math.round(fileSize / 1024)} KB), starting ffmpeg...`);
        fileReady = true;
        break;
      }
    }
    await new Promise<void>(r => setTimeout(r, 100));
  }

  if (!fileReady) {
    loggers.error(`[${tag}]`, `Temp file not ready after 30s! yt-dlp may have failed.`);
    try { ytDlpProc.kill("SIGTERM"); } catch { /* */ }
    throw new Error(`${tag}: yt-dlp download failed — no data received after 30s`);
  }

  // ---- Start ffmpeg (file has data now) ----
  loggers.log(`[${tag}]`, "Phase: STREAMING — ffmpeg reading from temp file...");

  const proc = Bun.spawn({
    cmd: [ffmpegPath, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",  // ffmpeg reads from temp file, no piping
  });

  loggers.log(`[${tag}]`, `[FFmpeg] Process started (PID: ${proc.pid})`);

  let stderrDrained = false;
  let firstOutputLogged = false;
  let lastProgressLog = 0;

  // Forward ffmpeg stderr to plugin logger with progress parsing
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
          loggers.log(`[${tag}]`, "Phase: RTP OUTPUT — ffmpeg producing RTP packets");
        }
        
        lineBuffer += text;
        // ffmpeg progress uses \r for in-place updates, split on both
        const lines = lineBuffer.split(/[\r\n]/);
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();
          if (!line) continue;
          
          // Parse ffmpeg progress lines (frame= 123 fps= 30 ...)
          const frameMatch = line.match(/frame=\s*(\d+)/);
          const timeMatch = line.match(/time=\s*([\d:.]+)/);
          const speedMatch = line.match(/speed=\s*([\d.]+)/);
          const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*\w+)/);

          if (frameMatch || timeMatch) {
            const now = Date.now();
            if (frameMatch) totalFrames = parseInt(frameMatch[1]!);
            // Log progress every 3 seconds
            if (now - lastProgressLog >= 3000) {
              lastProgressLog = now;
              const parts: string[] = [];
              if (frameMatch) parts.push(`frame=${frameMatch[1]}`);
              if (timeMatch) parts.push(`time=${timeMatch[1]}`);
              if (speedMatch) parts.push(`speed=${speedMatch[1]}x`);
              if (bitrateMatch) parts.push(`bitrate=${bitrateMatch[1]}`);
              loggers.log(`[${tag}]`, `[FFmpeg Progress] ${parts.join(", ")}`);
            }
            continue;  // Don't double-log progress lines as debug
          }
          
          if (line.includes("dropping frame") || line.includes("Past duration")) {
            droppedFrameCount++;
            if (droppedFrameCount === 1 || droppedFrameCount % 100 === 0) {
              loggers.debug(`[${tag}]`, "[FFmpeg]", `${line} (total dropped: ${droppedFrameCount})`);
            }
            continue;
          }
          
          // Log important lines (Input, Stream, Output, codec info) at info level
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
      loggers.log(`[${tag}]`, `[FFmpeg] Stream ended — total frames: ${totalFrames}, dropped: ${droppedFrameCount}`);
      loggers.debug(`[${tag}]`, "[FFmpeg] Stderr stream closed");
    }
  })();

  let killed = false;

  proc.exited.then(async (exitCode) => {
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
    kill() {
      killed = true;
      try {
        proc.kill("SIGTERM");
        ytDlpProc.kill("SIGTERM");
        loggers.debug(`[${tag}]`, "[Kill] SIGTERM sent to ffmpeg + yt-dlp");
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

// ---- HLS Streaming (Alternative to RTP) ----

/**
 * Options for spawning ffmpeg with HLS output.
 * Combines video and audio input streams into a single HLS manifest.
 */
export type SpawnFfmpegForHLSOptions = {
  videoUrl: string;
  audioUrl: string;
  outputDir: string;  // Directory where .m3u8 and .ts files are written
  playlistName?: string;  // Default: "stream.m3u8"
  segmentDuration?: number;  // HLS segment duration (default: 2s)
  segmentCount?: number;  // Number of segments in playlist (default: 6)
  videoBitrate: string;  // e.g., "2000k"
  audioBitrate: string;  // e.g., "128k"
  volume?: number;  // Audio volume 0-100 (default: 50)
  waitForDownloadComplete?: boolean;
  loggers: FfmpegLoggers;
  onEnd?: () => void;
};

/**
 * Spawn ffmpeg process for HLS streaming.
 *
 * Combines video and audio inputs into a single HLS stream.
 * Generates:
 * - stream.m3u8 (playlist manifest)
 * - stream0.ts, stream1.ts, ... (video segments)
 *
 * @param options Configuration for HLS streaming
 * @returns Promise<SpawnedProcess> with kill() method
 * @throws Error if ffmpeg binary not found or spawn fails
 *
 * Referenced by: REQ-002, REQ-003 (HLS variant)
 */
export const spawnFfmpegForHLS = async (
  options: SpawnFfmpegForHLSOptions
): Promise<SpawnedProcess> => {
  const tag = `[HLS]`;
  const {
    videoUrl,
    audioUrl,
    outputDir,
    playlistName = "stream.m3u8",
    segmentDuration = 2,
    segmentCount = 6,
    videoBitrate,
    audioBitrate,
    volume = 50,
    waitForDownloadComplete = false,
    loggers,
    onEnd,
  } = options;

  const ffmpegPath = getFfmpegPath();
  const normVolume = normalizeVolume(volume);

  // ffmpeg HLS command:
  // - Input: video URL (http)
  // - Input: audio URL (http)
  // - Output: HLS with passthrough codecs (copy for stability)
  // - Segment: 2s chunks, 6 segments in playlist
  
  const outputPath = path.join(outputDir, playlistName);
  
  loggers.log?.(tag, "[FFmpeg] Starting HLS spawn...");
  loggers.log?.(tag, `[FFmpeg] Binary: ${ffmpegPath}`);
  loggers.log?.(tag, `[FFmpeg] Video URL length: ${videoUrl.length} chars`);
  loggers.log?.(tag, `[FFmpeg] Audio URL length: ${audioUrl.length} chars`);
  loggers.log?.(tag, `[FFmpeg] Output dir: ${outputDir}`);
  loggers.log?.(tag, `[FFmpeg] Output path: ${outputPath}`);

  return new Promise((resolve, reject) => {
    try {
      if (!existsSync(ffmpegPath)) {
        throw new Error(`FFmpeg binary not found at: ${ffmpegPath}`);
      }
      loggers.log?.(tag, "[FFmpeg] Binary file exists ✓");
      loggers.log?.(tag, "[FFmpeg] Starting HLS spawn with User-Agent headers");

      const ffmpegCmd = [
        ffmpegPath,
        "-hide_banner",
        "-loglevel", "verbose",
        "-headers", "User-Agent: Mozilla/5.0",
        "-i", videoUrl,
        "-headers", "User-Agent: Mozilla/5.0",
        "-i", audioUrl,
        "-c:v", "copy",
        "-c:a", "copy",
        "-f", "hls",
        "-hls_time", String(segmentDuration),
        "-hls_list_size", String(segmentCount),
        "-hls_flags", "delete_segments",
        path.join(outputDir, playlistName),
      ];

      const proc = Bun.spawn({
        cmd: ffmpegCmd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      loggers.log?.(tag, `[FFmpeg] Process spawned (PID: ${proc.pid})`);

      let allOutput = "";
      const decoder = new TextDecoder();

      // Read both streams
      (async () => {
        const readers = [
          { stream: proc.stdout, name: "STDOUT" },
          { stream: proc.stderr, name: "STDERR" },
        ];

        for (const { stream, name } of readers) {
          if (!stream) continue;
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              allOutput += text;
              loggers.log?.(tag, `[${name}]`, text);
            }
          } catch (err) {
            loggers.error?.(tag, `[${name}] reader error`, err);
          }
        }
      })();

      // Wait for exit and log all output
      proc.exited.then((code) => {
        loggers.log?.(tag, "=".repeat(60));
        loggers.log?.(tag, `[FFmpeg] PROCESS EXITED WITH CODE: ${code}`);
        loggers.log?.(tag, "[FFmpeg] COMPLETE OUTPUT:");
        loggers.log?.(tag, allOutput || "(no output)");
        loggers.log?.(tag, "=".repeat(60));
        onEnd?.();
      });

      resolve({
        process: proc,
        kill: () => {
          loggers.log?.(tag, "[FFmpeg] Kill signal sent");
          proc.kill();
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loggers.error?.(tag, "[FFmpeg SPAWN FAILED]", msg);
      reject(new Error(`${tag}: Failed to spawn ffmpeg: ${msg}`));
    }
  });
};
