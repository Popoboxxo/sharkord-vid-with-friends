/**
 * Unit tests for ffmpeg stream spawning.
 *
 * TDD: Tests written BEFORE implementation.
 * Tests argument generation logic (not actual ffmpeg execution).
 *
 * Referenced by: REQ-002, REQ-003, REQ-012
 */
import { describe, it, expect } from "bun:test";
import {
  buildVideoStreamArgs,
  buildAudioStreamArgs,
  normalizeVolume,
  normalizeBitrate,
  getFfmpegBinaryName,
  buildYtDlpDownloadCmd,
  buildDebugCacheFileName,
  inferTempExtension,
  shouldUseLockedFormatId,
  shouldRetryWithoutFormatId,
  shouldWaitForDownloadComplete,
  shouldCleanupDownloadedData,
} from "../../src/stream/ffmpeg";

describe("ffmpeg", () => {
  // --- REQ-002: Video RTP stream args ---

  describe("buildVideoStreamArgs", () => {
    it("[REQ-002] should produce H264 RTP output args", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-f");
      expect(args).toContain("rtp");
      expect(args.some((a) => a.includes("127.0.0.1:40001"))).toBe(true);
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-payload_type");
      expect(args).toContain("96");
      expect(args).toContain("-ssrc");
      expect(args).toContain("123456");
    });

    it("[REQ-002] should include video-only flag (no audio)", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-an"); // no audio
    });

    it("[REQ-002] should use inputPath for file input", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-i");
      expect(args).toContain("/tmp/video.mp4");
    });

    it("[REQ-002] should default to realtime reading when realtimeReading not specified", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      // Function-level default is -re ON for progressive temp-file inputs
      expect(args).toContain("-re");
    });

    it("[REQ-038] should NOT use -re when realtimeReading is false", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
        realtimeReading: false,
      });

      expect(args).not.toContain("-re");
    });

    it("[REQ-002] should generate timestamps for piped input", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-fflags");
      expect(args).toContain("+genpts");
    });

    it("[REQ-002] should use H264 encoding with frequent keyframes", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      // Must use H264 encoding for Mediasoup RTP compatibility
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-profile:v");
      expect(args).toContain("baseline");
      // Must have frequent keyframes
      expect(args).toContain("-g");
      expect(args).toContain("25");
      expect(args).toContain("-x264-params");
      // Must NOT contain VP8-specific flags
      expect(args).not.toContain("libvpx");
      expect(args).not.toContain("-auto-alt-ref");
    });

    it("[REQ-002] should use info loglevel for diagnostics", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-loglevel");
      expect(args).toContain("info");
    });
  });

  // --- REQ-002: Audio RTP stream args ---

  describe("buildAudioStreamArgs", () => {
    it("[REQ-002] should produce Opus RTP output args", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 0.5,
      });

      expect(args).toContain("-c:a");
      expect(args).toContain("libopus");
      expect(args.some((a) => a.includes("127.0.0.1:40002"))).toBe(true);
      expect(args).toContain("-payload_type");
      expect(args).toContain("111");
      expect(args).toContain("-vn"); // no video
    });

    it("[REQ-012] should include volume filter when volume is not 1.0", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 0.5,
      });

      expect(args).toContain("-af");
      expect(args.some((a) => a.includes("volume=0.5"))).toBe(true);
    });

    it("[REQ-003] should include adelay filter when syncDelayMs is configured", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
        syncDelayMs: 450,
      });

      expect(args).toContain("-af");
      expect(args.some((a) => a.includes("adelay=450|450"))).toBe(true);
    });

    it("[REQ-003] should combine volume and adelay in a single filter chain", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 0.75,
        syncDelayMs: 300,
      });

      expect(args).toContain("-af");
      expect(args.some((a) => a.includes("volume=0.75,adelay=300|300"))).toBe(true);
    });

    it("[REQ-002] should use inputPath for file input", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-i");
      expect(args).toContain("/tmp/audio.webm");
    });

    it("[REQ-036-B] should use -re for progressive audio (default)", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-re");
    });

    it("[REQ-036-A] should NOT use -re for complete audio download", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
        realtimeReading: false,
      });

      expect(args).not.toContain("-re");
    });

    it("[REQ-002] should generate timestamps for piped input", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-fflags");
      expect(args).toContain("+genpts");
    });

    it("[REQ-002] should include probesize for fragmented MP4 detection", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-probesize");
      expect(args).toContain("-analyzeduration");
    });

    it("[REQ-002] should enforce RTP-safe Opus packet sizing", () => {
      const args = buildAudioStreamArgs({
        inputPath: "/tmp/audio.webm",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "256k",
        volume: 1,
      });

      expect(args).toContain("-frame_duration");
      expect(args).toContain("20");
      expect(args).toContain("-vbr");
      expect(args).toContain("off");
    });
  });

  // --- Helper utilities ---

  describe("normalizeVolume", () => {
    it("[REQ-012] should clamp volume to 0-1 float", () => {
      expect(normalizeVolume(50)).toBeCloseTo(0.5);
      expect(normalizeVolume(0)).toBe(0);
      expect(normalizeVolume(100)).toBe(1);
      expect(normalizeVolume(150)).toBe(1); // clamped
      expect(normalizeVolume(-10)).toBe(0); // clamped
    });
  });

  describe("normalizeBitrate", () => {
    it("should normalize various bitrate formats", () => {
      expect(normalizeBitrate("128k")).toBe("128k");
      expect(normalizeBitrate("128K")).toBe("128k");
      expect(normalizeBitrate("2000")).toBe("2000");
      expect(normalizeBitrate("")).toBe("192k");
      expect(normalizeBitrate(undefined)).toBe("192k");
      expect(normalizeBitrate("  256k  ")).toBe("256k");
    });
  });

  describe("shouldWaitForDownloadComplete", () => {
    it("[REQ-002] should wait for full download by default for video", () => {
      expect(shouldWaitForDownloadComplete("video")).toBe(true);
    });

    it("[REQ-002] should allow audio to skip full download by default", () => {
      expect(shouldWaitForDownloadComplete("audio")).toBe(false);
    });
  });

  describe("shouldCleanupDownloadedData", () => {
    it("[REQ-037] should cleanup downloaded data when debug mode is disabled", () => {
      expect(shouldCleanupDownloadedData(false)).toBe(true);
    });

    it("[REQ-037] should keep downloaded data when debug mode is enabled", () => {
      expect(shouldCleanupDownloadedData(true)).toBe(false);
    });
  });

  describe("getFfmpegBinaryName", () => {
    it("should return platform-appropriate binary name", () => {
      const name = getFfmpegBinaryName();
      if (process.platform === "win32") {
        expect(name).toBe("ffmpeg.exe");
      } else {
        expect(name).toBe("ffmpeg");
      }
    });
  });

  describe("buildYtDlpDownloadCmd", () => {
    it("[REQ-038] should prefer explicit formatId when provided", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "video",
        formatId: "137",
        debug: false,
        outputPath: "/tmp/output.mp4",
      });

      const formatIndex = cmd.indexOf("-f");
      expect(formatIndex).toBeGreaterThanOrEqual(0);
      expect(cmd[formatIndex + 1]).toBe("137");
    });

    it("[REQ-027-C] should include --verbose in debug mode", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "video",
        debug: true,
        outputPath: "/tmp/output.mp4",
      });

      expect(cmd).toContain("--verbose");
    });

    it("[REQ-027-B] should select audio format for audio streams", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/audio",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "audio",
        debug: false,
        outputPath: "/tmp/output.webm",
      });

      expect(cmd).toContain("-f");
      expect(cmd.some((part) => part.includes("ba/ba*"))).toBe(true);
    });

    it("[REQ-038] should NOT enable mpegts output hint when explicit formatId is locked", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "video",
        formatId: "137",
        useMpegTsOutput: true,
        debug: false,
        outputPath: "/tmp/output.ts",
      });

      expect(cmd).not.toContain("--hls-use-mpegts");
      expect(cmd).toContain("-f");
      expect(cmd).toContain("137");
    });

    it("[REQ-038] should enable mpegts output hint when no explicit formatId is provided", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "video",
        useMpegTsOutput: true,
        debug: false,
        outputPath: "/tmp/output.ts",
      });

      expect(cmd).toContain("--hls-use-mpegts");
      expect(cmd).toContain("-f");
      expect(cmd.some((part) => part.includes("bv[vcodec^=avc1]"))).toBe(true);
    });

    it("[REQ-038] should include --no-post-overwrites to prevent yt-dlp file replacement", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "video",
        debug: false,
        outputPath: "/tmp/output.mp4",
      });

      expect(cmd).toContain("--no-post-overwrites");
    });

    it("[REQ-038] should disable yt-dlp fixup/remux post-processing", () => {
      const cmd = buildYtDlpDownloadCmd({
        ytDlpPath: "/bin/yt-dlp",
        ffmpegLocation: "/bin",
        sourceUrl: "https://example.com/video",
        youtubeUrl: "https://www.youtube.com/watch?v=H6P3kJ8nrR8",
        streamType: "audio",
        debug: false,
        outputPath: "/tmp/output.m4a",
      });

      expect(cmd).toContain("--fixup");
      expect(cmd).toContain("never");
    });
  });

  describe("shouldRetryWithoutFormatId", () => {
    it("[REQ-027-D] should retry when a locked format becomes unavailable", () => {
      expect(
        shouldRetryWithoutFormatId(
          1,
          "ERROR: [youtube] abc123: Requested format is not available",
          "140"
        )
      ).toBe(true);
    });

    it("[REQ-027-D] should not retry without a locked format id", () => {
      expect(
        shouldRetryWithoutFormatId(
          1,
          "ERROR: [youtube] abc123: Requested format is not available",
          undefined
        )
      ).toBe(false);
    });

    it("[REQ-027-D] should not retry for successful exits", () => {
      expect(
        shouldRetryWithoutFormatId(
          0,
          "ERROR: [youtube] abc123: Requested format is not available",
          "140"
        )
      ).toBe(false);
    });

    it("[REQ-027-D] should retry on exit 1 with locked format when stderr is empty", () => {
      expect(
        shouldRetryWithoutFormatId(
          1,
          "",
          "140"
        )
      ).toBe(true);
    });
  });

  describe("inferTempExtension", () => {
    it("[REQ-038] should use m4a temp extension for AAC formatId 140", () => {
      expect(inferTempExtension("audio", "140", false)).toBe("m4a");
    });

    it("[REQ-038] should use webm temp extension for Opus formatId 251", () => {
      expect(inferTempExtension("audio", "251", false)).toBe("webm");
    });

    it("[REQ-038] should use mp4 temp extension for locked H264 formatId 137", () => {
      expect(inferTempExtension("video", "137", true)).toBe("mp4");
    });

    it("[REQ-038] should use ts for progressive video without locked format", () => {
      expect(inferTempExtension("video", undefined, true)).toBe("ts");
    });

    it("[REQ-038] should use webm for progressive audio without locked format", () => {
      expect(inferTempExtension("audio", undefined, true)).toBe("webm");
    });
  });

  describe("shouldUseLockedFormatId", () => {
    it("[REQ-036-A] should keep locked format in full download mode", () => {
      expect(shouldUseLockedFormatId(true)).toBe(true);
    });

    it("[REQ-036-B] should disable locked format in progressive mode", () => {
      expect(shouldUseLockedFormatId(false)).toBe(false);
    });
  });

  describe("buildDebugCacheFileName", () => {
    it("[REQ-032] should include stream type and video id", () => {
      const name = buildDebugCacheFileName({
        streamType: "video",
        videoId: "H6P3kJ8nrR8",
        now: 1700000000000,
      });

      expect(name).toContain("video");
      expect(name).toContain("H6P3kJ8nrR8");
      expect(name).toContain("1700000000000");
    });
  });
});
