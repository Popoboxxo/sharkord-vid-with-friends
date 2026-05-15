/**
 * ffmpeg configuration builders — pure functions for constructing command arguments.
 *
 * Referenced by: REQ-002, REQ-012, REQ-026, REQ-038, REQ-043
 */

import { normalizeBitrate, isHlsSubFormatId } from "./ffmpeg-utils";
import type { VideoStreamOptions, AudioStreamOptions, YtDlpDownloadOptions } from "./ffmpeg-types";

/** Build yt-dlp download command for downloading to temp file. (REQ-027-B, REQ-027-C) */
export const buildYtDlpDownloadCmd = (options: YtDlpDownloadOptions & { outputPath: string }): string[] => {
  const {
    ytDlpPath,
    ffmpegLocation,
    sourceUrl,
    youtubeUrl,
    formatId,
    streamType,
    useMpegTsOutput = false,
    cookiesPath,
    debug,
    outputPath,
  } = options;

  const cmd: string[] = [
    ytDlpPath,
    "--no-warnings",
    "--newline",
    "--no-part",
    "--no-post-overwrites",
    "--fixup", "never",
  ];

  if (debug) cmd.push("--verbose");
  if (cookiesPath) cmd.push("--cookies", cookiesPath);
  cmd.push("--ffmpeg-location", ffmpegLocation);

  if (streamType === "video" && useMpegTsOutput && !(formatId && formatId.trim() && !isHlsSubFormatId(formatId))) {
    cmd.push("--hls-use-mpegts");
  }

  if (youtubeUrl) {
    if (formatId && formatId.trim() && !isHlsSubFormatId(formatId)) {
      cmd.push("-f", formatId.trim(), "-o", outputPath, youtubeUrl);
    } else {
      const formatSel = streamType === "video"
        ? "bv[vcodec^=avc1][height<=1080]/bv[vcodec^=avc1]/bv*[vcodec^=avc1]/bv[vcodec^=vp09][height<=1080]/bv[vcodec^=vp09]/bv[vcodec^=av01][height<=1080]/bv[vcodec^=av01]/bv[height<=1080]/bv"
        : "ba[acodec=opus]/ba[acodec=aac]/ba[acodec^=mp4a]/ba/ba*/bestaudio[acodec=opus]/bestaudio[acodec=aac]/bestaudio";
      cmd.push("-f", formatSel, "-o", outputPath, youtubeUrl);
    }
  } else {
    cmd.push("-o", outputPath, sourceUrl);
  }

  return cmd;
};

/**
 * Build ffmpeg args for streaming video via RTP directly from a source URL. (REQ-002)
 */
export const buildVideoStreamArgs = (options: VideoStreamOptions): string[] => {
  const {
    inputPath, rtpHost, rtpPort, payloadType, ssrc, bitrate,
    realtimeReading = true,
    fullDownloadMode = false,
    debugEnabled = false,
  } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  const realtimeFlags = realtimeReading ? ["-re"] : [];

  let avSyncFlags: string[];
  if (fullDownloadMode) {
    avSyncFlags = [
      "-fps_mode", "passthrough",
      "-avoid_negative_ts", "make_zero",
    ];
  } else {
    avSyncFlags = [
      "-fps_mode", "cfr",
      "-max_muxing_queue_size", "9999",
    ];
  }

  return [
    "-hide_banner",
    "-loglevel", "info",
    ...realtimeFlags,
    "-fflags", "+genpts",
    "-probesize", "30000000",
    "-analyzeduration", "30000000",
    "-i", inputPath,
    "-an",
    ...avSyncFlags,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-pix_fmt", "yuv420p",
    "-b:v", bitrateNorm,
    "-maxrate", bitrateNorm,
    "-bufsize", "2M",
    "-g", "25",
    "-keyint_min", "25",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-payload_type", String(payloadType),
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpHost}:${rtpPort}?pkt_size=1200`,
  ];
};

/**
 * Build ffmpeg args for streaming audio via RTP directly from a source URL. (REQ-002, REQ-012)
 */
export const buildAudioStreamArgs = (options: AudioStreamOptions): string[] => {
  const {
    inputPath, rtpHost, rtpPort, payloadType, ssrc, bitrate, volume, syncDelayMs = 0,
    realtimeReading = true,
    fullDownloadMode = false,
  } = options;
  const bitrateNorm = normalizeBitrate(bitrate);

  const filterGraph: string[] = [];
  if (volume !== 1) filterGraph.push(`volume=${volume}`);

  const normalizedSyncDelayMs = Math.max(0, Math.min(2000, Math.floor(syncDelayMs)));
  if (normalizedSyncDelayMs > 0) {
    filterGraph.push(`adelay=${normalizedSyncDelayMs}|${normalizedSyncDelayMs}`);
  }

  const audioFilterArgs = filterGraph.length > 0 ? ["-af", filterGraph.join(",")] : [];
  const realtimeFlags = realtimeReading ? ["-re"] : [];

  const avSyncFlags: string[] = fullDownloadMode
    ? [
        "-async", "1",
        "-avoid_negative_ts", "make_zero",
      ]
    : [
        "-async", "1",
      ];

  return [
    "-hide_banner",
    "-loglevel", "info",
    ...realtimeFlags,
    "-fflags", "+genpts",
    "-probesize", "30000000",
    "-analyzeduration", "30000000",
    "-i", inputPath,
    "-vn",
    ...avSyncFlags,
    ...audioFilterArgs,
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", bitrateNorm,
    "-vbr", "off",
    "-frame_duration", "20",
    "-application", "audio",
    "-payload_type", String(payloadType),
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpHost}:${rtpPort}?pkt_size=1200`,
  ];
};
