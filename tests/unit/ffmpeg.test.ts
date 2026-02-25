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
} from "../../src/stream/ffmpeg";

describe("ffmpeg", () => {
  // --- REQ-002: Video RTP stream args ---

  describe("buildVideoStreamArgs", () => {
    it("[REQ-002] should produce VP8 RTP output args", () => {
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
      expect(args).toContain("libvpx");
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

    it("[REQ-002] should read input in realtime to avoid fast playback", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-re");
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

    it("[REQ-002] should use VP8 realtime encoding with frequent keyframes", () => {
      const args = buildVideoStreamArgs({
        inputPath: "/tmp/video.mp4",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      // Must use VP8 encoding for WebRTC compatibility
      expect(args).toContain("-c:v");
      expect(args).toContain("libvpx");
      expect(args).toContain("-deadline");
      expect(args).toContain("realtime");
      // Must have frequent keyframes
      expect(args).toContain("-g");
      expect(args).toContain("25");
      // Must disable alt-ref frames for streaming
      expect(args).toContain("-auto-alt-ref");
      expect(args).toContain("0");
      // Must NOT contain H264-specific flags
      expect(args).not.toContain("libx264");
      expect(args).not.toContain("-profile:v");
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

    it("[REQ-002] should read input in realtime to avoid fast playback", () => {
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
