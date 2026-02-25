/**
 * E2E smoke test — verifies the plugin can be imported and basic wiring works in Docker.
 *
 * This test runs inside the Docker container where ffmpeg and yt-dlp are available.
 * It does NOT require a running Sharkord instance.
 *
 * Referenced by: REQ-015
 */
import { describe, it, expect } from "bun:test";

describe("E2E Smoke", () => {
  const STREAM_TEST_URL = "https://www.youtube.com/watch?v=H6P3kJ8nrR8";
  const RUN_STREAMING_TESTS = process.env.RUN_STREAMING_TESTS === "1";

  it("[REQ-015] should import plugin entry without errors", async () => {
    // Dynamic import to test that the module resolves correctly
    const plugin = await import("../../src/index");
    expect(plugin.onLoad).toBeFunction();
    expect(plugin.onUnload).toBeFunction();
  });

  // Skip binary checks when not running inside Docker (yt-dlp/ffmpeg may not be in PATH locally)
  const isDocker = process.env.BUN_ENV === "test" && process.env.NODE_ENV === "test";

  it("[REQ-002] should have ffmpeg available", async () => {
    if (!isDocker) {
      const { buildVideoStreamArgs } = await import("../../src/stream/ffmpeg");
      const args = buildVideoStreamArgs({ sourceUrl: "test", rtpHost: "127.0.0.1", rtpPort: 40000, payloadType: 96, ssrc: 1, bitrate: "2000k" });
      expect(args.length).toBeGreaterThan(0);
      return;
    }

    const proc = Bun.spawn(["ffmpeg", "-version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const output = await new Response(proc.stdout).text();
    expect(output).toContain("ffmpeg version");
  });

  it("[REQ-001] should have yt-dlp available", async () => {
    if (!isDocker) {
      // Gracefully skip outside Docker — just verify args builder works
      const { buildYtDlpArgs } = await import("../../src/stream/yt-dlp");
      const args = buildYtDlpArgs({ ytDlpPath: "yt-dlp", sourceUrl: "test", mode: "json" });
      expect(args.length).toBeGreaterThan(0);
      return;
    }

    const proc = Bun.spawn(["yt-dlp", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const output = await new Response(proc.stdout).text();
    // yt-dlp version should be a date-like string (e.g. "2024.01.01")
    expect(output.trim()).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
  });

  it("[REQ-002] should build ffmpeg args without errors", async () => {
    const { buildVideoStreamArgs, buildAudioStreamArgs } = await import("../../src/stream/ffmpeg");

    const videoArgs = buildVideoStreamArgs({
      sourceUrl: "https://example.com/stream.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40000,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
    });
    expect(videoArgs).toContain("-f");
    expect(videoArgs).toContain("rtp");

    const audioArgs = buildAudioStreamArgs({
      sourceUrl: "https://example.com/stream.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 111,
      ssrc: 654321,
      bitrate: "128k",
      volume: 0.5,
    });
    expect(audioArgs).toContain("-f");
    expect(audioArgs).toContain("rtp");
  });

  it("[REQ-001] should build yt-dlp args without errors", async () => {
    const { buildYtDlpArgs, isYouTubeUrl, parseYtDlpOutput } = await import("../../src/stream/yt-dlp");

    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://example.com")).toBe(false);

    const args = buildYtDlpArgs({
      ytDlpPath: "/usr/local/bin/yt-dlp",
      sourceUrl: "https://www.youtube.com/watch?v=test",
      mode: "json",
    });
    expect(args.length).toBeGreaterThan(0);
  });

  it("[REQ-004] should manage queue without errors", async () => {
    const { QueueManager } = await import("../../src/queue/queue-manager");

    const qm = new QueueManager();

    qm.add(1, {
      id: "test-1",
      query: "test",
      title: "Test Video",
      youtubeUrl: "https://youtube.com/watch?v=test",
      videoProfileLevelId: "",
      streamUrl: "https://example.com/stream",
      audioUrl: "https://example.com/audio",
      duration: 180,
      thumbnail: "https://example.com/thumb.jpg",
      addedBy: 1,
      addedAt: Date.now(),
    });

    const state = qm.getState(1);
    expect(state.size).toBe(1);
    expect(state.current?.title).toBe("Test Video");
  });

  it("[REQ-002] should stream for 5s via yt-dlp + ffmpeg", async () => {
    if (!isDocker || !RUN_STREAMING_TESTS) return;

    const ytDlpProc = Bun.spawn([
      "yt-dlp",
      "--no-warnings",
      "-f",
      "bv[vcodec^=avc1][height<=1080]/bv[vcodec^=avc1]/bv*[vcodec^=avc1]",
      "-o",
      "-",
      STREAM_TEST_URL,
    ], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const ffmpegProc = Bun.spawn([
      "ffmpeg",
      "-hide_banner",
      "-nostats",
      "-loglevel", "error",
      "-re",
      "-fflags", "+genpts",
      "-i", "pipe:0",
      "-an",
      "-c:v", "copy",
      "-bsf:v", "h264_mp4toannexb",
      "-t", "5",
      "-f", "rtp",
      "rtp://127.0.0.1:40000?pkt_size=1200",
    ], {
      stdin: ytDlpProc.stdout,
      stdout: "ignore",
      stderr: "pipe",
    });

    const exitCode = await ffmpegProc.exited;

    try { ytDlpProc.kill("SIGTERM"); } catch { /* ignore */ }

    expect(exitCode).toBe(0);
  });
});
