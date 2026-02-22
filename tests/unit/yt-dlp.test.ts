/**
 * Unit tests for yt-dlp wrapper.
 *
 * TDD: Tests written BEFORE implementation.
 * Tests URL detection and parsing logic (not actual yt-dlp execution).
 *
 * Referenced by: REQ-001, REQ-002
 */
import { describe, it, expect } from "bun:test";
import {
  isYouTubeUrl,
  buildYtDlpArgs,
  parseYtDlpOutput,
  getYtDlpBinaryName,
} from "../../src/stream/yt-dlp";

describe("yt-dlp", () => {
  // --- REQ-001: YouTube URL/Query erkennen ---

  describe("isYouTubeUrl", () => {
    it("[REQ-001] should recognize standard youtube.com URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
      expect(isYouTubeUrl("https://youtube.com/watch?v=abc123")).toBe(true);
      expect(isYouTubeUrl("http://youtube.com/watch?v=abc123")).toBe(true);
    });

    it("[REQ-001] should recognize youtu.be short URLs", () => {
      expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    });

    it("[REQ-001] should recognize ytsearch: prefixed queries", () => {
      expect(isYouTubeUrl("ytsearch:funny cats")).toBe(true);
    });

    it("[REQ-001] should reject non-YouTube URLs", () => {
      expect(isYouTubeUrl("https://vimeo.com/12345")).toBe(false);
      expect(isYouTubeUrl("https://example.com")).toBe(false);
      expect(isYouTubeUrl("not a url at all")).toBe(false);
    });
  });

  // --- REQ-001: Build yt-dlp command arguments ---

  describe("buildYtDlpArgs", () => {
    it("[REQ-001] should build URL resolution args", () => {
      const args = buildYtDlpArgs({
        ytDlpPath: "/bin/yt-dlp",
        sourceUrl: "https://youtube.com/watch?v=test",
        mode: "url",
      });

      expect(args).toContain("/bin/yt-dlp");
      expect(args).toContain("-g");
      expect(args).toContain("https://youtube.com/watch?v=test");
    });

    it("[REQ-001] should build title resolution args", () => {
      const args = buildYtDlpArgs({
        ytDlpPath: "/bin/yt-dlp",
        sourceUrl: "https://youtube.com/watch?v=test",
        mode: "title",
      });

      expect(args).toContain("--get-title");
    });

    it("[REQ-001] should build JSON info args for full metadata", () => {
      const args = buildYtDlpArgs({
        ytDlpPath: "/bin/yt-dlp",
        sourceUrl: "https://youtube.com/watch?v=test",
        mode: "json",
      });

      expect(args).toContain("--dump-json");
      expect(args).toContain("--no-download");
    });

    it("[REQ-001] should include cookies path when provided", () => {
      const args = buildYtDlpArgs({
        ytDlpPath: "/bin/yt-dlp",
        sourceUrl: "https://youtube.com/watch?v=test",
        mode: "url",
        cookiesPath: "/path/cookies.txt",
      });

      expect(args).toContain("--cookies");
      expect(args).toContain("/path/cookies.txt");
    });

    it("[REQ-001] should request best video+audio for video mode", () => {
      const args = buildYtDlpArgs({
        ytDlpPath: "/bin/yt-dlp",
        sourceUrl: "https://youtube.com/watch?v=test",
        mode: "url",
      });

      // Should use format that gets both video and audio
      expect(args.some((a) => a.includes("best"))).toBe(true);
    });
  });

  // --- REQ-001: Parse yt-dlp output ---

  describe("parseYtDlpOutput", () => {
    it("[REQ-001] should parse JSON output with video info", () => {
      const json = JSON.stringify({
        title: "Test Video",
        url: "https://stream.example.com/video",
        duration: 300,
        thumbnail: "https://img.example.com/thumb.jpg",
        formats: [
          { format_id: "251", acodec: "opus", url: "https://audio.example.com" },
          { format_id: "137", vcodec: "avc1", url: "https://video.example.com" },
        ],
      });

      const result = parseYtDlpOutput(json);

      expect(result.title).toBe("Test Video");
      expect(result.duration).toBe(300);
      expect(result.thumbnail).toBe("https://img.example.com/thumb.jpg");
    });

    it("[REQ-001] should handle missing optional fields gracefully", () => {
      const json = JSON.stringify({
        title: "Minimal Video",
        url: "https://stream.example.com/video",
      });

      const result = parseYtDlpOutput(json);

      expect(result.title).toBe("Minimal Video");
      expect(result.duration).toBe(0);
      expect(result.thumbnail).toBe("");
    });

    it("[REQ-001] should throw on invalid JSON", () => {
      expect(() => parseYtDlpOutput("not json")).toThrow();
    });

    it("[REQ-001] should throw on missing title", () => {
      const json = JSON.stringify({ url: "https://example.com" });
      expect(() => parseYtDlpOutput(json)).toThrow();
    });
  });

  // --- Binary name ---

  describe("getYtDlpBinaryName", () => {
    it("should return platform-appropriate binary name", () => {
      const name = getYtDlpBinaryName();
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      // On Windows: yt-dlp.exe, on unix: yt-dlp
      if (process.platform === "win32") {
        expect(name).toBe("yt-dlp.exe");
      } else {
        expect(name).toBe("yt-dlp");
      }
    });
  });
});
