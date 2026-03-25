/**
 * Unit tests for CDN-URL fallback when YouTube forces SABR streaming.
 *
 * TDD: Tests verify that shouldRetryWithCdnUrl triggers correctly when all
 * YouTube-URL-based format selectors fail with "Requested format is not available".
 *
 * REQ-045: CDN-URL-Fallback bei vollständigem SABR-Block
 *
 * Tests are purely about logic — no yt-dlp binary required.
 */
import { describe, it, expect } from "bun:test";
import { shouldRetryWithCdnUrl, buildYtDlpDownloadCmd } from "../../src/stream/ffmpeg";

const CDN_URL = "https://rr2---sn-4g5e6nz7.googlevideo.com/videoplayback?expire=1774493785&id=abc123";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=ye4hoPA48bI";
const SABR_STDERR = "ERROR: [youtube] ye4hoPA48bI: Requested format is not available. Use --list-formats for a list of available formats";

// ---- REQ-045-A: shouldRetryWithCdnUrl trigger conditions ----

describe("shouldRetryWithCdnUrl (REQ-045)", () => {
  it("[REQ-045-A] should return true when yt-dlp fails with format-not-available and sourceUrl is CDN URL", () => {
    expect(shouldRetryWithCdnUrl(1, SABR_STDERR, CDN_URL, YOUTUBE_URL)).toBe(true);
  });

  it("[REQ-045-C] should return false when sourceUrl is a YouTube URL (not a CDN URL)", () => {
    // Prevent infinite retry loop — only CDN URLs are eligible for direct download
    const youTubeSourceUrl = "https://www.youtube.com/watch?v=ye4hoPA48bI";
    expect(shouldRetryWithCdnUrl(1, SABR_STDERR, youTubeSourceUrl, YOUTUBE_URL)).toBe(false);
  });

  it("[REQ-045-C] should return false when youtubeUrl is not set (already using CDN fallback path)", () => {
    // If youtubeUrl is absent, we are already downloading from CDN — no further fallback
    expect(shouldRetryWithCdnUrl(1, SABR_STDERR, CDN_URL, undefined)).toBe(false);
  });

  it("[REQ-045-A] should return false when exit code is 0 (no error)", () => {
    expect(shouldRetryWithCdnUrl(0, "", CDN_URL, YOUTUBE_URL)).toBe(false);
  });

  it("[REQ-045-A] should return false when exit code is 143 (SIGTERM — intentional kill)", () => {
    expect(shouldRetryWithCdnUrl(143, "", CDN_URL, YOUTUBE_URL)).toBe(false);
  });

  it("[REQ-045-A] should return false when exit code is null (process still running)", () => {
    expect(shouldRetryWithCdnUrl(null, SABR_STDERR, CDN_URL, YOUTUBE_URL)).toBe(false);
  });

  it("[REQ-045-A] should return false when stderr does not contain format-not-available message", () => {
    const otherError = "ERROR: [youtube] Network timeout";
    expect(shouldRetryWithCdnUrl(1, otherError, CDN_URL, YOUTUBE_URL)).toBe(false);
  });

  it("[REQ-045-A] should match case-insensitively for format-not-available error", () => {
    const lowerCaseError = "error: requested format is not available";
    expect(shouldRetryWithCdnUrl(1, lowerCaseError, CDN_URL, YOUTUBE_URL)).toBe(true);
  });

  it("[REQ-045-C] should return true for any googlevideo.com subdomain CDN URL", () => {
    const otherCdnUrl = "https://rr5---sn-xyz.googlevideo.com/videoplayback?expire=123456";
    expect(shouldRetryWithCdnUrl(1, SABR_STDERR, otherCdnUrl, YOUTUBE_URL)).toBe(true);
  });
});

// ---- REQ-045-B: buildYtDlpDownloadCmd CDN fallback path ----

describe("buildYtDlpDownloadCmd — CDN fallback mode (REQ-045-B)", () => {
  const baseOptions = {
    ytDlpPath: "/usr/bin/yt-dlp",
    ffmpegLocation: "/usr/bin",
    sourceUrl: CDN_URL,
    streamType: "video" as const,
    debug: false,
    outputPath: "/tmp/video.mp4",
  };

  it("[REQ-045-B] should use sourceUrl directly when youtubeUrl is not set", () => {
    const cmd = buildYtDlpDownloadCmd({ ...baseOptions });
    // CDN URL must appear in the command
    expect(cmd).toContain(CDN_URL);
    // YouTube URL must NOT be in the command
    expect(cmd).not.toContain(YOUTUBE_URL);
  });

  it("[REQ-045-B] should NOT include a -f format selector when using CDN URL directly", () => {
    const cmd = buildYtDlpDownloadCmd({ ...baseOptions });
    // No format selector when downloading from pre-resolved CDN URL
    expect(cmd).not.toContain("-f");
  });

  it("[REQ-045-B] should include output path when using CDN URL", () => {
    const cmd = buildYtDlpDownloadCmd({ ...baseOptions });
    expect(cmd).toContain("-o");
    expect(cmd).toContain("/tmp/video.mp4");
  });

  it("[REQ-045-B] should use YouTube URL when youtubeUrl is provided (normal path)", () => {
    const cmd = buildYtDlpDownloadCmd({ ...baseOptions, youtubeUrl: YOUTUBE_URL });
    // YouTube URL must appear in the command in normal mode
    expect(cmd).toContain(YOUTUBE_URL);
    // CDN URL must NOT be in the command in normal mode (YouTube URL takes precedence)
    expect(cmd).not.toContain(CDN_URL);
  });
});
