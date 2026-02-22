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
    it("[REQ-002] should produce H264 RTP output args", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "https://stream.example.com/video",
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
      expect(args).toContain("-payload_type");
      expect(args).toContain("96");
      expect(args).toContain("-ssrc");
      expect(args).toContain("123456");
    });

    it("[REQ-002] should include video-only flag (no audio)", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "https://stream.example.com/video",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-an"); // no audio
    });

    it("[REQ-002] should include reconnect args for network sources", () => {
      const args = buildVideoStreamArgs({
        sourceUrl: "https://stream.example.com/video",
        rtpHost: "127.0.0.1",
        rtpPort: 40001,
        payloadType: 96,
        ssrc: 123456,
        bitrate: "2000k",
      });

      expect(args).toContain("-reconnect");
      expect(args).toContain("1");
    });
  });

  // --- REQ-002: Audio RTP stream args ---

  describe("buildAudioStreamArgs", () => {
    it("[REQ-002] should produce Opus RTP output args", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "https://stream.example.com/video",
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
        sourceUrl: "https://stream.example.com/video",
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

    it("[REQ-002] should include reconnect args for network sources", () => {
      const args = buildAudioStreamArgs({
        sourceUrl: "https://stream.example.com/video",
        rtpHost: "127.0.0.1",
        rtpPort: 40002,
        payloadType: 111,
        ssrc: 789012,
        bitrate: "128k",
        volume: 1,
      });

      expect(args).toContain("-reconnect");
      expect(args).toContain("1");
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
