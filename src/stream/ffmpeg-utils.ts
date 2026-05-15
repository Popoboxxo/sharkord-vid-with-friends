/**
 * ffmpeg utilities — pure helper functions (testable without ffmpeg binary).
 *
 * Referenced by: REQ-002, REQ-012, REQ-027, REQ-032, REQ-037, REQ-042, REQ-045
 */

import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Get the platform-appropriate ffmpeg binary name. */
export const getFfmpegBinaryName = (): string =>
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

const getFfmpegFallbackBinaryName = (): string =>
  process.platform === "win32" ? "ffmpeg" : "ffmpeg.exe";

const getPluginBinCandidates = (): string[] => {
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const sharkordDataPath = process.env["SHARKORD_DATA_PATH"]
    ?? (homeDir ? path.join(homeDir, ".config", "sharkord") : "");

  const candidates = [
    path.join(__dirname, "bin"),
    sharkordDataPath ? path.join(sharkordDataPath, "plugins", "sharkord-vid-with-friends", "bin") : "",
    "/home/bun/.config/sharkord/plugins/sharkord-vid-with-friends/bin",
  ];

  return candidates.filter((value) => value.length > 0);
};

/** Get the full path to the ffmpeg binary in the plugin's bin/ directory. */
export const getFfmpegPath = (): string => {
  const envOverride = process.env["FFMPEG_PATH"];
  if (typeof envOverride === "string" && envOverride.trim().length > 0) {
    return envOverride.trim();
  }

  for (const binDir of getPluginBinCandidates()) {
    const preferred = path.join(binDir, getFfmpegBinaryName());
    if (existsSync(preferred)) {
      return preferred;
    }

    const fallback = path.join(binDir, getFfmpegFallbackBinaryName());
    if (existsSync(fallback)) {
      return fallback;
    }
  }

  const fromPath = Bun.which(getFfmpegBinaryName()) ?? Bun.which(getFfmpegFallbackBinaryName());
  if (fromPath) {
    return fromPath;
  }

  return getFfmpegBinaryName();
};

/** Normalize a user-provided volume (0-100) to a 0-1 float. (REQ-012) */
export const normalizeVolume = (volume: number): number =>
  Math.min(1, Math.max(0, volume / 100));

/** Normalize a bitrate string to a consistent format. */
export const normalizeBitrate = (bitrate?: string): string => {
  if (!bitrate) return "192k";
  const trimmed = bitrate.trim();
  if (!trimmed) return "192k";
  if (/^\d+(?:\.\d+)?k$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return "192k";
};

export const parseFfmpegDurationToSeconds = (line: string): number | null => {
  const durationMatch = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!durationMatch) return null;
  const hours = parseInt(durationMatch[1]!, 10);
  const minutes = parseInt(durationMatch[2]!, 10);
  const seconds = parseInt(durationMatch[3]!, 10);
  return hours * 3600 + minutes * 60 + seconds;
};

export const parseProgressTimeToSeconds = (timeText: string): number | null => {
  const match = timeText.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);
  const fractionalRaw = match[4] ?? "0";
  const fractionalSeconds = Number.parseFloat(`0.${fractionalRaw}`);
  return hours * 3600 + minutes * 60 + seconds + (Number.isFinite(fractionalSeconds) ? fractionalSeconds : 0);
};

/** Use locked format ids only for full-download mode; progressive mode keeps adaptive selection. */
export const shouldUseLockedFormatId = (waitForFullDownload: boolean): boolean =>
  waitForFullDownload;

/** Decide if ffmpeg should wait for a full download before starting. */
export const shouldWaitForDownloadComplete = (streamType: "video" | "audio"): boolean =>
  streamType === "video";

/** Decide whether downloaded media files should be deleted after usage. (REQ-037) */
export const shouldCleanupDownloadedData = (debugEnabled: boolean): boolean =>
  !debugEnabled;

/** Returns true if a format ID is an HLS sub-format that may not be available across different server IPs. (REQ-042) */
export const isHlsSubFormatId = (formatId: string | undefined): boolean => {
  if (!formatId || !formatId.trim()) return false;
  return /^\d+-\d+$/.test(formatId.trim());
};

/** Decide whether a failed yt-dlp run should be retried without a strict format lock. (REQ-027) */
export const shouldRetryWithoutFormatId = (
  exitCode: number | null,
  stderrText: string,
  formatId?: string
): boolean => {
  if (!formatId || !formatId.trim()) return false;
  if (isHlsSubFormatId(formatId)) return true;
  if (exitCode === null || exitCode === 0 || exitCode === 143) return false;
  if (/Requested format is not available/i.test(stderrText)) return true;
  return exitCode === 1 && stderrText.trim().length === 0;
};

/** Decide whether a failed yt-dlp run should be retried using the pre-resolved CDN URL directly. (REQ-045) */
export const shouldRetryWithCdnUrl = (
  exitCode: number | null,
  stderrText: string,
  sourceUrl: string,
  youtubeUrl?: string,
): boolean => {
  if (!youtubeUrl || !youtubeUrl.trim()) return false;
  if (!sourceUrl.includes("googlevideo.com")) return false;
  if (exitCode === null || exitCode === 0 || exitCode === 143) return false;
  if (/Requested format is not available/i.test(stderrText)) return true;
  return false;
};

export const extractYouTubeId = (url: string): string => {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? "";
};

export const getDebugCacheDir = (): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
  return path.join(homeDir, ".config", "sharkord", "vid-with-friends-cache");
};

/** Build a debug cache filename for a yt-dlp stream. (REQ-032) */
export const buildDebugCacheFileName = (options: { streamType: "video" | "audio"; videoId: string; now: number }): string => {
  const safeId = options.videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `yt-dlp-${options.streamType}-${safeId || "unknown"}-${options.now}.bin`;
};

/** Build a temp file path for yt-dlp downloads. (REQ-002) */
export const buildTempFilePath = (
  videoId: string,
  streamType: "video" | "audio",
  extension?: "mp4" | "m4a" | "webm" | "ts"
): string => {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
  const timestamp = Date.now();
  const cacheDir = getDebugCacheDir();
  const resolvedExtension = extension ?? (streamType === "video" ? "mp4" : "webm");
  return path.join(cacheDir, `temp-${streamType}-${safeId}-${timestamp}.${resolvedExtension}`);
};

/** Pick a temp-file extension that matches the locked format as closely as possible. (REQ-038) */
export const inferTempExtension = (
  streamType: "video" | "audio",
  formatId: string | undefined,
  progressiveMode: boolean
): "mp4" | "m4a" | "webm" | "ts" => {
  if (streamType === "video") {
    if (progressiveMode && (!formatId || !formatId.trim())) return "ts";
    return "mp4";
  }

  if (progressiveMode && (!formatId || !formatId.trim())) return "webm";

  const normalizedFormat = (formatId ?? "").trim();
  const opusLikeAudioFormats = new Set(["249", "250", "251", "171", "172"]);
  return opusLikeAudioFormats.has(normalizedFormat) ? "webm" : "m4a";
};
