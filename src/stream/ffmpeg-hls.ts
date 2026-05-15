/**
 * HLS Streaming — spawns ffmpeg with HLS output using temp files.
 *
 * Referenced by: REQ-002, REQ-003
 */

import path from "path";
import { existsSync, mkdirSync } from "fs";
import { getFfmpegPath, normalizeVolume, extractYouTubeId, buildTempFilePath } from "./ffmpeg-utils";
import { buildYtDlpDownloadCmd } from "./ffmpeg-config";
import type { SpawnFfmpegForHLSOptions, FfmpegLoggers, SpawnedProcess } from "./ffmpeg-types";

/**
 * Spawn ffmpeg process for HLS streaming WITH TEMP FILES.
 *
 * Combines video and audio inputs into a single HLS stream.
 */
export const spawnFfmpegForHLS = async (
  options: SpawnFfmpegForHLSOptions & { youtubeUrl?: string }
): Promise<SpawnedProcess> => {
  const tag = `[HLS]`;
  const {
    videoUrl,
    audioUrl,
    youtubeUrl,
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
  const binDir = path.dirname(ffmpegPath);
  const ytDlpPath = path.join(binDir, "yt-dlp");
  const cookiesPath = path.join(binDir, "cookies.txt");
  const normVolume = normalizeVolume(volume);

  loggers.log?.(tag, "[Starting HLS with temp-file method]");
  loggers.log?.(tag, `Binary: ${ffmpegPath}`);
  loggers.log?.(tag, `Output dir: ${outputDir}`);

  const videoId = extractYouTubeId(youtubeUrl || videoUrl);
  const tempVideoFile = buildTempFilePath(videoId, "video");
  const tempAudioFile = buildTempFilePath(videoId, "audio");

  const cacheDir = path.dirname(tempVideoFile);
  mkdirSync(cacheDir, { recursive: true });

  loggers.log?.(tag, `Temp video: ${path.basename(tempVideoFile)}`);
  loggers.log?.(tag, `Temp audio: ${path.basename(tempAudioFile)}`);

  const ytDlpVideoCmd = buildYtDlpDownloadCmd({
    ytDlpPath,
    ffmpegLocation: binDir,
    sourceUrl: videoUrl,
    youtubeUrl,
    streamType: "video",
    cookiesPath: existsSync(cookiesPath) ? cookiesPath : undefined,
    debug: false,
    outputPath: tempVideoFile,
  });

  const ytDlpAudioCmd = buildYtDlpDownloadCmd({
    ytDlpPath,
    ffmpegLocation: binDir,
    sourceUrl: audioUrl,
    youtubeUrl,
    streamType: "audio",
    cookiesPath: existsSync(cookiesPath) ? cookiesPath : undefined,
    debug: false,
    outputPath: tempAudioFile,
  });

  loggers.log?.(tag, "[Phase 1/3] Starting yt-dlp downloads (video + audio)...");

  const ytDlpVideo = Bun.spawn({
    cmd: ytDlpVideoCmd,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  const ytDlpAudio = Bun.spawn({
    cmd: ytDlpAudioCmd,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  loggers.log?.(tag, `yt-dlp video PID: ${ytDlpVideo.pid}`);
  loggers.log?.(tag, `yt-dlp audio PID: ${ytDlpAudio.pid}`);

  const monitorYtDlpStderr = async (proc: ReturnType<typeof Bun.spawn>, label: string) => {
    if (!proc.stderr) return;
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.includes("ERROR") || text.includes("WARNING")) {
          loggers.debug?.(tag, `[yt-dlp ${label}]`, text.trim());
        }
      }
    } catch { /* ignore */ }
  };

  monitorYtDlpStderr(ytDlpVideo, "video");
  monitorYtDlpStderr(ytDlpAudio, "audio");

  loggers.log?.(tag, "[Phase 2/3] Waiting for download data...");
  let videoReady = false;
  let audioReady = false;

  for (let i = 0; i < 300; i++) {
    if (!videoReady && existsSync(tempVideoFile)) {
      const size = Bun.file(tempVideoFile).size;
      if (size > 10000) {
        videoReady = true;
        loggers.log?.(tag, `✓ Video file ready (${Math.round(size / 1024)} KB)`);
      }
    }
    if (!audioReady && existsSync(tempAudioFile)) {
      const size = Bun.file(tempAudioFile).size;
      if (size > 10000) {
        audioReady = true;
        loggers.log?.(tag, `✓ Audio file ready (${Math.round(size / 1024)} KB)`);
      }
    }
    if (videoReady && audioReady) break;
    await new Promise<void>(r => setTimeout(r, 100));
  }

  if (!videoReady || !audioReady) {
    loggers.error?.(tag, "Download timeout — files not ready after 30s");
    try { ytDlpVideo.kill("SIGTERM"); } catch { /* */ }
    try { ytDlpAudio.kill("SIGTERM"); } catch { /* */ }
    throw new Error(`${tag}: Download failed — temp files not ready`);
  }

  loggers.log?.(tag, "[Phase 3/3] Starting ffmpeg HLS encoding...");

  const outputPath = path.join(outputDir, playlistName);
  const ffmpegCmd = [
    ffmpegPath,
    "-hide_banner",
    "-loglevel", "info",
    "-re",
    "-i", tempVideoFile,
    "-i", tempAudioFile,
    "-c:v", "copy",
    "-c:a", "copy",
    "-f", "hls",
    "-hls_time", String(segmentDuration),
    "-hls_list_size", String(segmentCount),
    "-hls_flags", "delete_segments",
    outputPath,
  ];

  if (!existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg binary not found at: ${ffmpegPath}`);
  }

  const proc = Bun.spawn({
    cmd: ffmpegCmd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  loggers.log?.(tag, `[FFmpeg] Process started (PID: ${proc.pid})`);

  (async () => {
    if (!proc.stderr) return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (lineBuffer.trim()) loggers.debug?.(tag, "[FFmpeg]", lineBuffer.trim());
          break;
        }
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();
          if (line && (line.includes("Input") || line.includes("Output") || line.includes("Stream") || line.includes("error"))) {
            loggers.log?.(tag, "[FFmpeg]", line);
          } else if (line) {
            loggers.debug?.(tag, "[FFmpeg]", line);
          }
        }
        lineBuffer = lines[lines.length - 1] ?? "";
      }
    } catch { /* ignore */ }
  })();

  const ytDlpProcesses = [ytDlpVideo, ytDlpAudio];
  proc.exited.then(async (code: number) => {
    loggers.log?.(tag, `[FFmpeg] Exited with code ${code}`);
    for (const p of ytDlpProcesses) {
      try { p.kill("SIGTERM"); } catch { /* */ }
    }
    onEnd?.();
  });

  return {
    process: proc,
    getLastPtsSeconds(): number {
      return 0;
    },
    kill: () => {
      loggers.log?.(tag, "[Kill] Stopping ffmpeg + yt-dlp processes");
      try { proc.kill("SIGTERM"); } catch { /* */ }
      for (const p of ytDlpProcesses) {
        try { p.kill("SIGTERM"); } catch { /* */ }
      }
    },
  };
};
