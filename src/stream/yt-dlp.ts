/**
 * yt-dlp wrapper — YouTube URL resolution and metadata extraction.
 *
 * Provides pure functions for building command args and parsing output,
 * plus an async function for actual execution via Bun.spawn.
 *
 * Referenced by: REQ-001
 */
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import type { ResolvedVideo } from "../queue/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Types ----

export type YtDlpMode = "url" | "title" | "json";

export type YtDlpBuildOptions = {
  ytDlpPath: string;
  sourceUrl: string;
  mode: YtDlpMode;
  cookiesPath?: string;
  ffmpegLocation?: string;
};

export type YtDlpLoggers = {
  log: (...messages: unknown[]) => void;
  debug: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
};

// ---- Pure functions (testable without yt-dlp binary) ----

/** Check if a URL/query targets YouTube. (REQ-001) */
export const isYouTubeUrl = (url: string): boolean =>
  url.includes("youtube.com") ||
  url.includes("youtu.be") ||
  url.startsWith("ytsearch:");

/** Get the platform-appropriate yt-dlp binary name. */
export const getYtDlpBinaryName = (): string =>
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

/** Get the full path to the yt-dlp binary in the plugin's bin/ directory. */
export const getYtDlpPath = (): string =>
  path.join(__dirname, "bin", getYtDlpBinaryName());

/** Build yt-dlp command arguments for different modes. (REQ-001) */
export const buildYtDlpArgs = (options: YtDlpBuildOptions): string[] => {
  const { ytDlpPath, sourceUrl, mode, cookiesPath, ffmpegLocation } = options;

  const base = [ytDlpPath, "--js-runtimes", "bun"];
  const cookies = cookiesPath ? ["--cookies", cookiesPath] : [];
  const ffmpeg = ffmpegLocation ? ["--ffmpeg-location", ffmpegLocation] : [];

  switch (mode) {
    case "url":
      return [...base, ...cookies, ...ffmpeg, "-f", "best[ext=mp4]/best", "-g", sourceUrl];
    case "title":
      return [...base, ...cookies, ...ffmpeg, "--get-title", sourceUrl];
    case "json":
      return [...base, ...cookies, ...ffmpeg, "--dump-json", "--no-download", sourceUrl];
  }
};

/** Parse yt-dlp JSON output into a ResolvedVideo. (REQ-001) */
export const parseYtDlpOutput = (jsonString: string): ResolvedVideo => {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error("Failed to parse yt-dlp output as JSON");
  }

  if (!data || typeof data !== "object") {
    throw new Error("yt-dlp output is not an object");
  }

  const obj = data as Record<string, unknown>;

  if (!obj["title"] || typeof obj["title"] !== "string") {
    throw new Error("yt-dlp output missing required field: title");
  }

  const title = obj["title"] as string;
  const duration = typeof obj["duration"] === "number" ? obj["duration"] : 0;
  const thumbnail = typeof obj["thumbnail"] === "string" ? obj["thumbnail"] : "";
  
  // Extract original YouTube URL for piping (REQ-026)
  const youtubeUrl = (obj["webpage_url"] as string) || (obj["original_url"] as string) || "";

  // Extract best video and audio URLs from formats (REQ-026)
  let streamUrl = "";
  let audioUrl = "";
  let videoFormatId = "";
  let audioFormatId = "";
  
  if (Array.isArray(obj["formats"])) {
    const formats = obj["formats"] as Record<string, unknown>[];
    
    // Find best H.264 (avc1) video format — MUST be H.264 for Mediasoup/RTP copy mode.
    // YouTube also offers VP9/AV1 which are higher quality but incompatible with
    // our -c:v copy + h264_mp4toannexb pipeline and the video/H264 Mediasoup producer.
    const isH264 = (vcodec: unknown): boolean => {
      if (typeof vcodec !== "string") return false;
      const vc = vcodec.toLowerCase();
      return vc.startsWith("avc") || vc.includes("h264") || vc.startsWith("h.264");
    };

    const h264Formats = formats
      .filter((f) => isH264(f["vcodec"]) && f["url"])
      .sort((a, b) => {
        const heightA = typeof a["height"] === "number" ? a["height"] : 0;
        const heightB = typeof b["height"] === "number" ? b["height"] : 0;
        return heightB - heightA;  // Higher resolution first
      });

    // Pick best H.264 format (prefer ≤1080p for bandwidth)
    const videoFormat = h264Formats.find((f) => {
      const h = typeof f["height"] === "number" ? f["height"] : 9999;
      return h <= 1080;
    }) || h264Formats[0];
    
    if (videoFormat && typeof videoFormat["url"] === "string") {
      streamUrl = videoFormat["url"];
      videoFormatId = String(videoFormat["format_id"] || "");
    }
    
    // Find best audio-only format (AAC preferred for reliable decoding)
    const audioFormat = formats
      .filter((f) => f["acodec"] && f["acodec"] !== "none" && (!f["vcodec"] || f["vcodec"] === "none") && f["url"])
      .sort((a, b) => {
        const brA = typeof a["abr"] === "number" ? a["abr"] : 0;
        const brB = typeof b["abr"] === "number" ? b["abr"] : 0;
        return brB - brA;  // Higher bitrate first
      })[0];
    
    if (audioFormat && typeof audioFormat["url"] === "string") {
      audioUrl = audioFormat["url"];
      audioFormatId = String(audioFormat["format_id"] || "");
    }
  }
  
  // Fallback: use top-level URL if formats parsing failed
  if (!streamUrl && obj["url"] && typeof obj["url"] === "string") {
    streamUrl = obj["url"];
  }

  return { 
    title, 
    youtubeUrl, 
    streamUrl: streamUrl || audioUrl, 
    audioUrl: audioUrl || streamUrl, 
    duration, 
    thumbnail,
    videoFormatId,
    audioFormatId,
  };
};

// ---- Runtime functions (require yt-dlp binary) ----

/** Run a yt-dlp command and return stdout/stderr/exitCode. */
const runYtDlp = async (
  cmd: string[],
  loggers: YtDlpLoggers
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (stderr.trim()) {
    loggers.error("[yt-dlp stderr]", stderr.trim());
  }
  
  if (exitCode !== 0) {
    loggers.error("[yt-dlp]", `Process exited with code ${exitCode}`);
  }

  return { stdout, stderr, exitCode };
};

/** Check if a cookies file exists. */
const cookiesExist = async (cookiesPath: string): Promise<boolean> => {
  try {
    const file = Bun.file(cookiesPath);
    return await file.exists();
  } catch {
    return false;
  }
};

/**
 * Resolve a YouTube URL/search query to a ResolvedVideo.
 * Requires yt-dlp binary in the plugin's bin/ directory.
 * (REQ-001)
 */
export const resolveVideo = async (
  sourceUrl: string,
  loggers: YtDlpLoggers
): Promise<ResolvedVideo> => {
  const ytDlpPath = getYtDlpPath();
  const binDir = path.join(__dirname, "bin");
  const cookiesPath = path.join(binDir, "cookies.txt");
  const cookies = (await cookiesExist(cookiesPath)) ? cookiesPath : undefined;

  // Point yt-dlp to the ffmpeg binary in the same bin/ directory
  const ffmpegLocation = binDir;

  // REQ-027-A: Phase RESOLVING
  loggers.log("[Phase] RESOLVING — yt-dlp --dump-json started for:", sourceUrl.substring(0, 80));

  // Use JSON mode for full metadata
  const jsonArgs = buildYtDlpArgs({
    ytDlpPath,
    sourceUrl,
    mode: "json",
    cookiesPath: cookies,
    ffmpegLocation,
  });

  const jsonRes = await runYtDlp(jsonArgs, loggers);
  if (jsonRes.exitCode !== 0) {
    throw new Error(
      `yt-dlp failed to resolve video (exit ${jsonRes.exitCode}). Check if yt-dlp is installed in bin/ directory.`
    );
  }

  const firstLine = jsonRes.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
  if (!firstLine) {
    throw new Error("yt-dlp returned empty output");
  }

  const resolved = parseYtDlpOutput(firstLine);

  // REQ-027-A: Phase RESOLVED
  loggers.log("[Phase] RESOLVED —", `title: "${resolved.title}", duration: ${resolved.duration}s`);

  // REQ-027-A: Phase FORMAT_SELECTED
  loggers.log("[Phase] FORMAT_SELECTED —",
    `videoFormatId: ${resolved.videoFormatId || "none"}, audioFormatId: ${resolved.audioFormatId || "none"},`,
    `streamUrl: ${resolved.streamUrl ? resolved.streamUrl.length + " chars" : "none"},`,
    `audioUrl: ${resolved.audioUrl ? resolved.audioUrl.length + " chars" : "none"}`
  );

  // If JSON mode didn't give us a direct stream URL, fall back to -g
  if (!resolved.streamUrl) {
    const urlArgs = buildYtDlpArgs({
      ytDlpPath,
      sourceUrl,
      mode: "url",
      cookiesPath: cookies,
      ffmpegLocation,
    });

    const urlRes = await runYtDlp(urlArgs, loggers);
    if (urlRes.exitCode === 0) {
      const url = urlRes.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
      if (url) {
        resolved.streamUrl = url;
      }
    }
  }

  return resolved;
};
