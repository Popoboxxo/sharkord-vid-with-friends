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
  const streamUrl = (obj["url"] as string) ?? "";
  const duration = typeof obj["duration"] === "number" ? obj["duration"] : 0;
  const thumbnail = typeof obj["thumbnail"] === "string" ? obj["thumbnail"] : "";

  // Try to find separate audio URL from formats
  let audioUrl = "";
  if (Array.isArray(obj["formats"])) {
    const audioFormat = (obj["formats"] as Record<string, unknown>[]).find(
      (f) => f["acodec"] && f["acodec"] !== "none" && (!f["vcodec"] || f["vcodec"] === "none")
    );
    if (audioFormat && typeof audioFormat["url"] === "string") {
      audioUrl = audioFormat["url"];
    }
  }

  return { title, streamUrl: streamUrl || audioUrl, audioUrl, duration, thumbnail };
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
    loggers.error("[yt-dlp]", stderr.trim());
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
