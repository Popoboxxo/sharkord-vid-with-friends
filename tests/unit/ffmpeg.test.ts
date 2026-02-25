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
} from "../../src/stream/ffmpeg";

describe("ffmpeg", () => {
  // --- REQ-002: Video RTP stream args ---

  describe("buildVideoStreamArgs", () => {
    it("[REQ-002] should produce H264 RTP output args with copy mode", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
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
      expect(args).toContain("copy");
      expect(args).toContain("-payload_type");
      expect(args).toContain("96");
      expect(args).toContain("-ssrc");
      expect(args).toContain("123456");
    });

    it("[REQ-002] should include video-only flag (no audio)", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-an"); // no audio
    });

    it("[REQ-026] should use pipe:0 for URL input (avoid buffer overflow)", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-i");
      expect(args).toContain("pipe:0");
    });

    it("[REQ-002] should read input in realtime to avoid fast playback", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-re");
    });

    it("[REQ-002] should use copy mode instead of re-encoding (avoids frame drops)", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      // Must use copy mode — re-encoding 1080p60 causes massive frame drops
      expect(args).toContain("-c:v");
      expect(args).toContain("copy");
      // Must NOT have encoding-specific flags
      expect(args).not.toContain("libx264");
      expect(args).not.toContain("-preset");
      expect(args).not.toContain("-profile:v");
    });

    it("[REQ-002] should include h264_mp4toannexb bitstream filter for RTP NAL format", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-bsf:v");
      expect(args).toContain("h264_mp4toannexb");
    });

    it("[REQ-026] should use warning loglevel to reduce log spam", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-loglevel");
      expect(args).toContain("warning");
    });
  });

  // --- REQ-002: Audio RTP stream args ---

  describe("buildAudioStreamArgs", () => {
    it("[REQ-002] should produce Opus RTP output args", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "test-url",
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
        sourceUrl: "test-url",
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

    it("[REQ-026] should use pipe:0 for URL input (avoid buffer overflow)", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      // URL is passed via stdin (pipe:0) to avoid command-line buffer overflow
      expect(args).toContain("-i");
      expect(args).toContain("pipe:0");
    });

    it("[REQ-002] should read input in realtime to avoid fast playback", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "test-url",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-re");
    });

    it("[REQ-002] should include probesize for fragmented MP4 detection", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "test-url",
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
});
