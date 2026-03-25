/**
 * Unit tests for SABR streaming and HLS sub-format ID handling.
 *
 * TDD: Tests cover the SABR format fallback logic introduced in REQ-042.
 * Tests pure functions only — no binary execution required.
 *
 * Referenced by: REQ-042
 */
import { describe, it, expect } from "bun:test";
import {
  isHlsSubFormatId,
  shouldRetryWithoutFormatId,
  buildYtDlpDownloadCmd,
} from "../../src/stream/ffmpeg";
import { parseYtDlpOutput } from "../../src/stream/yt-dlp";

// ---- isHlsSubFormatId ----

describe("isHlsSubFormatId", () => {
  it("[REQ-042] should return true for format '301-0'", () => {
    expect(isHlsSubFormatId("301-0")).toBe(true);
  });

  it("[REQ-042] should return true for format '248-1'", () => {
    expect(isHlsSubFormatId("248-1")).toBe(true);
  });

  it("[REQ-042] should return true for format '0-0'", () => {
    expect(isHlsSubFormatId("0-0")).toBe(true);
  });

  it("[REQ-042] should return false for '140-drc' (suffix is not digits)", () => {
    expect(isHlsSubFormatId("140-drc")).toBe(false);
  });

  it("[REQ-042] should return false for plain format id '301' (no suffix)", () => {
    expect(isHlsSubFormatId("301")).toBe(false);
  });

  it("[REQ-042] should return false for format '140'", () => {
    expect(isHlsSubFormatId("140")).toBe(false);
  });

  it("[REQ-042] should return false for format '137'", () => {
    expect(isHlsSubFormatId("137")).toBe(false);
  });

  it("[REQ-042] should return false for empty string", () => {
    expect(isHlsSubFormatId("")).toBe(false);
  });

  it("[REQ-042] should return false for undefined", () => {
    expect(isHlsSubFormatId(undefined)).toBe(false);
  });
});

// ---- shouldRetryWithoutFormatId with HLS sub-format IDs ----

describe("shouldRetryWithoutFormatId", () => {
  it("[REQ-042] should return true immediately for HLS sub-format id even with exit 1", () => {
    expect(shouldRetryWithoutFormatId(1, "", "301-0")).toBe(true);
  });

  it("[REQ-042] should return true for HLS sub-format id even with exit 0 (never reliably downloadable)", () => {
    expect(shouldRetryWithoutFormatId(0, "", "301-0")).toBe(true);
  });

  it("[REQ-042] should return true for normal format id when stderr says format not available", () => {
    expect(
      shouldRetryWithoutFormatId(1, "Requested format is not available", "140")
    ).toBe(true);
  });

  it("[REQ-042] should return false for normal format id with exit 0 and no error", () => {
    expect(shouldRetryWithoutFormatId(0, "", "140")).toBe(false);
  });
});

// ---- buildYtDlpDownloadCmd — HLS sub-format IDs fall back to selector ----

describe("buildYtDlpDownloadCmd — HLS sub-format fallback", () => {
  const BASE_OPTIONS = {
    ytDlpPath: "/bin/yt-dlp",
    ffmpegLocation: "/bin",
    sourceUrl: "https://cdn.example.com/video.mp4",
    youtubeUrl: "https://www.youtube.com/watch?v=test123",
    streamType: "video" as const,
    useMpegTsOutput: false,
    debug: false,
    outputPath: "/tmp/test.mp4",
  };

  it("[REQ-042] should NOT pass '-f 301-0' when formatId is an HLS sub-format id", () => {
    const cmd = buildYtDlpDownloadCmd({ ...BASE_OPTIONS, formatId: "301-0" });
    // The format arg directly after -f must never be the raw HLS sub-format id
    const fIndex = cmd.indexOf("-f");
    expect(fIndex).toBeGreaterThan(-1);
    const formatArg = cmd[fIndex + 1];
    expect(formatArg).not.toBe("301-0");
  });

  it("[REQ-042] should use fallback format selector (not locked id) for HLS sub-format", () => {
    const cmd = buildYtDlpDownloadCmd({ ...BASE_OPTIONS, formatId: "301-0" });
    const fIndex = cmd.indexOf("-f");
    const formatArg = cmd[fIndex + 1] ?? "";
    // Fallback selector contains bv[vcodec^=avc1] for video
    expect(formatArg).toContain("avc1");
  });

  it("[REQ-042] should still use locked format id for normal numeric format ids", () => {
    const cmd = buildYtDlpDownloadCmd({ ...BASE_OPTIONS, formatId: "140" });
    const fIndex = cmd.indexOf("-f");
    const formatArg = cmd[fIndex + 1];
    expect(formatArg).toBe("140");
  });
});

// ---- buildYtDlpDownloadCmd — extended video fallback selector ----

describe("buildYtDlpDownloadCmd — extended video fallback selector", () => {
  const BASE_OPTIONS = {
    ytDlpPath: "/bin/yt-dlp",
    ffmpegLocation: "/bin",
    sourceUrl: "https://www.youtube.com/watch?v=test123",
    youtubeUrl: "https://www.youtube.com/watch?v=test123",
    streamType: "video" as const,
    useMpegTsOutput: false,
    debug: false,
    outputPath: "/tmp/test.mp4",
  };

  it("[REQ-042] should include vp09 in the fallback format selector for video", () => {
    const cmd = buildYtDlpDownloadCmd({ ...BASE_OPTIONS }); // no formatId → always fallback
    const fIndex = cmd.indexOf("-f");
    const formatArg = cmd[fIndex + 1] ?? "";
    expect(formatArg).toContain("vp09");
  });

  it("[REQ-042] should include av01 in the fallback format selector for video", () => {
    const cmd = buildYtDlpDownloadCmd({ ...BASE_OPTIONS });
    const fIndex = cmd.indexOf("-f");
    const formatArg = cmd[fIndex + 1] ?? "";
    expect(formatArg).toContain("av01");
  });
});

// ---- parseYtDlpOutput — SABR manifest URLs and HLS sub-format IDs filtered ----

describe("parseYtDlpOutput — SABR and HLS sub-format filtering", () => {
  /** Minimal valid yt-dlp JSON with only SABR manifest URLs as formats */
  const makeSabrOnlyJson = (): string =>
    JSON.stringify({
      title: "Test Video",
      duration: 300,
      thumbnail: "https://i.ytimg.com/vi/test/hqdefault.jpg",
      webpage_url: "https://www.youtube.com/watch?v=test",
      formats: [
        {
          format_id: "301-0",
          vcodec: "avc1.4d401f",
          acodec: "none",
          height: 1080,
          url: "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/123/id/test/itag/301/source/yt_live_broadcast/requiressl/yes/ratebypass/yes/hls_chunk_host/something.googlevideo.com/index.m3u8",
        },
        {
          format_id: "140-0",
          vcodec: "none",
          acodec: "mp4a.40.2",
          abr: 128,
          url: "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/456/id/test/itag/140/source/yt_live_broadcast/requiressl/yes/ratebypass/yes/index.m3u8",
        },
      ],
    });

  it("[REQ-042] should return empty videoFormatId when all video formats are SABR manifest URLs", () => {
    const result = parseYtDlpOutput(makeSabrOnlyJson());
    expect(result.videoFormatId).toBe("");
  });

  it("[REQ-042] should return empty streamUrl when all video formats are SABR manifest URLs", () => {
    const result = parseYtDlpOutput(makeSabrOnlyJson());
    // streamUrl must not be a SABR manifest URL
    expect(result.streamUrl).not.toContain("manifest.googlevideo.com");
  });

  /** Minimal valid yt-dlp JSON where all video formats have HLS sub-format ids */
  const makeHlsSubIdOnlyJson = (): string =>
    JSON.stringify({
      title: "Test Video",
      duration: 200,
      thumbnail: "",
      webpage_url: "https://www.youtube.com/watch?v=test2",
      formats: [
        {
          format_id: "248-1",
          vcodec: "avc1.640028",
          acodec: "none",
          height: 1080,
          url: "https://rr1---sn-example.googlevideo.com/videoplayback?id=248",
        },
        {
          format_id: "302-2",
          vcodec: "avc1.4d401f",
          acodec: "none",
          height: 720,
          url: "https://rr2---sn-example.googlevideo.com/videoplayback?id=302",
        },
      ],
    });

  it("[REQ-042] should return empty videoFormatId when all H.264 video formats have HLS sub-format ids", () => {
    const result = parseYtDlpOutput(makeHlsSubIdOnlyJson());
    expect(result.videoFormatId).toBe("");
  });

  it("[REQ-042] should return empty streamUrl when all H.264 video formats have HLS sub-format ids", () => {
    const result = parseYtDlpOutput(makeHlsSubIdOnlyJson());
    expect(result.streamUrl).toBe("");
  });

  /** Mix: one SABR format + one valid direct format */
  const makeMixedJson = (): string =>
    JSON.stringify({
      title: "Mixed Video",
      duration: 250,
      thumbnail: "",
      webpage_url: "https://www.youtube.com/watch?v=mixed",
      formats: [
        {
          format_id: "137",
          vcodec: "avc1.640028",
          acodec: "none",
          height: 1080,
          url: "https://rr1---sn-example.googlevideo.com/videoplayback?itag=137",
        },
        {
          format_id: "301-0",
          vcodec: "avc1.4d401f",
          acodec: "none",
          height: 1080,
          url: "https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/301/index.m3u8",
        },
      ],
    });

  it("[REQ-042] should prefer valid direct format over SABR manifest URL in mixed formats", () => {
    const result = parseYtDlpOutput(makeMixedJson());
    expect(result.videoFormatId).toBe("137");
    expect(result.streamUrl).toContain("videoplayback");
  });
});
