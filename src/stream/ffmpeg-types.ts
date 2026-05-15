/**
 * ffmpeg wrapper types.
 *
 * Referenced by: REQ-002, REQ-003, REQ-012, REQ-043, REQ-044
 */

// Bun has global Timer type from timers
type BunTimer = ReturnType<typeof setTimeout>;

export type VideoStreamOptions = {
  inputPath: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
  realtimeReading?: boolean;
  fullDownloadMode?: boolean;
  debugEnabled?: boolean;
};

export type AudioStreamOptions = {
  inputPath: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
  volume: number;
  syncDelayMs?: number;
  realtimeReading?: boolean;
  fullDownloadMode?: boolean;
  debugEnabled?: boolean;
};

export type FfmpegLoggers = {
  log: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
  debug: (...messages: unknown[]) => void;
};

export type SpawnedProcess = {
  process: ReturnType<typeof Bun.spawn>;
  kill: () => void;
  tempFilePath?: string;
  /** REQ-043-A: Returns the latest PTS (presentation timestamp) parsed from ffmpeg stderr in seconds. */
  getLastPtsSeconds: () => number;
};

export type YtDlpDownloadOptions = {
  ytDlpPath: string;
  ffmpegLocation: string;
  sourceUrl: string;
  youtubeUrl?: string;
  formatId?: string;
  streamType: "video" | "audio";
  useMpegTsOutput?: boolean;
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
  formatId?: string;
  rtpHost: string;
  rtpPort: number;
  payloadType: number;
  ssrc: number;
  bitrate: string;
  volume?: number;
  syncDelayMs?: number;
  debugEnabled?: boolean;
  waitForDownloadComplete?: boolean;
  expectedDurationSeconds?: number;
  waitForSyncStartSignal?: Promise<void>;
  notifyReadyForSyncStart?: () => void;
  onProgressTimeSeconds?: (seconds: number) => void;
  loggers: FfmpegLoggers;
  onPhaseChange?: (phase: "DOWNLOADING" | "BUFFERING" | "STREAMING") => void;
  onEnd?: () => void;
};

export type SpawnFfmpegForHLSOptions = {
  videoUrl: string;
  audioUrl: string;
  outputDir: string;
  playlistName?: string;
  segmentDuration?: number;
  segmentCount?: number;
  videoBitrate: string;
  audioBitrate: string;
  volume?: number;
  waitForDownloadComplete?: boolean;
  loggers: FfmpegLoggers;
  onEnd?: () => void;
};

export type TempExtension = "mp4" | "m4a" | "webm" | "ts";
