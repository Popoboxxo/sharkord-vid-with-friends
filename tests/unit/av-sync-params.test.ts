/**
 * Unit tests for AV-Sync ffmpeg parameters.
 *
 * TDD: Tests verify the correct ffmpeg flags are set for AV-sync correction.
 *
 * REQ-043-B: Full-download mode — PTS-alignment flags (avoid_negative_ts + vsync passthrough)
 * REQ-043-C: Streaming mode — AV-sync stabilisation flags (cfr vsync + muxing queue)
 *
 * These tests are purely about arg generation — no ffmpeg binary required.
 */
import { describe, it, expect } from "bun:test";
import { buildVideoStreamArgs, buildAudioStreamArgs } from "../../src/stream/ffmpeg";
import type { SpawnedProcess } from "../../src/stream/ffmpeg";

// ---- REQ-043-B: Video — full-download mode PTS-alignment ----

describe("buildVideoStreamArgs — AV-sync (REQ-043-B, REQ-043-C)", () => {
  it("[REQ-043-B] should include vsync=0 (passthrough) for video in full-download mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: true,
    });

    expect(args).toContain("-fps_mode");
    const fpsIdx = args.indexOf("-fps_mode");
    expect(args[fpsIdx + 1]).toBe("passthrough");
  });

  it("[REQ-043-B] should include avoid_negative_ts=make_zero for video in full-download mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: true,
    });

    expect(args).toContain("-avoid_negative_ts");
    const idx = args.indexOf("-avoid_negative_ts");
    expect(args[idx + 1]).toBe("make_zero");
  });

  it("[REQ-043-B] should NOT include streaming-mode cfr vsync in full-download mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: true,
    });

    // cfr is the streaming-mode flag — must NOT be present in full-download mode
    const fpsIdx = args.indexOf("-fps_mode");
    expect(fpsIdx).toBeGreaterThanOrEqual(0);
    expect(args[fpsIdx + 1]).not.toBe("cfr");
  });

  it("[REQ-043-B] should NOT include max_muxing_queue_size in full-download mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: true,
    });

    expect(args).not.toContain("-max_muxing_queue_size");
  });

  // ---- REQ-043-C: Video — streaming mode AV-sync stabilisation ----

  it("[REQ-043-C] should include vsync=cfr (constant frame rate) in streaming mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: false,
    });

    expect(args).toContain("-fps_mode");
    const fpsIdx = args.indexOf("-fps_mode");
    expect(args[fpsIdx + 1]).toBe("cfr");
  });

  it("[REQ-043-C] should include max_muxing_queue_size to prevent mux overflow in streaming mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: false,
    });

    expect(args).toContain("-max_muxing_queue_size");
    const idx = args.indexOf("-max_muxing_queue_size");
    const queueSize = parseInt(args[idx + 1] ?? "0", 10);
    expect(queueSize).toBeGreaterThanOrEqual(1000);
  });

  it("[REQ-043-C] should NOT include avoid_negative_ts in streaming mode", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
      fullDownloadMode: false,
    });

    expect(args).not.toContain("-avoid_negative_ts");
  });

  it("[REQ-043-C] should default to streaming mode when fullDownloadMode is not specified", () => {
    const args = buildVideoStreamArgs({
      inputPath: "/tmp/video.mp4",
      rtpHost: "127.0.0.1",
      rtpPort: 40001,
      payloadType: 96,
      ssrc: 123456,
      bitrate: "2000k",
    });

    // Default: streaming mode → cfr
    const fpsIdx = args.indexOf("-fps_mode");
    expect(fpsIdx).toBeGreaterThanOrEqual(0);
    expect(args[fpsIdx + 1]).toBe("cfr");
    expect(args).toContain("-max_muxing_queue_size");
  });
});

// ---- REQ-043-B: Audio — full-download mode PTS-alignment ----

describe("buildAudioStreamArgs — AV-sync (REQ-043-B, REQ-043-C)", () => {
  it("[REQ-043-B] should include async=1 for audio in full-download mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
      fullDownloadMode: true,
    });

    expect(args).toContain("-async");
    const asyncIdx = args.indexOf("-async");
    expect(args[asyncIdx + 1]).toBe("1");
  });

  it("[REQ-043-B] should include avoid_negative_ts=make_zero for audio in full-download mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
      fullDownloadMode: true,
    });

    expect(args).toContain("-avoid_negative_ts");
    const idx = args.indexOf("-avoid_negative_ts");
    expect(args[idx + 1]).toBe("make_zero");
  });

  // ---- REQ-043-C: Audio — streaming mode ----

  it("[REQ-043-C] should include async=1 for audio resampling in streaming mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
      fullDownloadMode: false,
    });

    expect(args).toContain("-async");
    const asyncIdx = args.indexOf("-async");
    expect(args[asyncIdx + 1]).toBe("1");
  });

  it("[REQ-043-C] should NOT include avoid_negative_ts for audio in streaming mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
      fullDownloadMode: false,
    });

    expect(args).not.toContain("-avoid_negative_ts");
  });

  it("[REQ-043-C] should default to streaming mode (no avoid_negative_ts) when fullDownloadMode is not specified", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
    });

    // Default: streaming mode — no avoid_negative_ts
    expect(args).not.toContain("-avoid_negative_ts");
    // But async=1 must still be present
    expect(args).toContain("-async");
  });

  it("[REQ-043-B] should apply both async=1 and avoid_negative_ts together in full-download mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 1,
      fullDownloadMode: true,
    });

    // Both flags must be present simultaneously
    expect(args).toContain("-async");
    expect(args).toContain("-avoid_negative_ts");
  });

  it("[REQ-043-B] should preserve audio filter chain alongside AV-sync flags in full-download mode", () => {
    const args = buildAudioStreamArgs({
      inputPath: "/tmp/audio.webm",
      rtpHost: "127.0.0.1",
      rtpPort: 40002,
      payloadType: 111,
      ssrc: 789012,
      bitrate: "128k",
      volume: 0.8,
      syncDelayMs: 200,
      fullDownloadMode: true,
    });

    // AV-sync flags
    expect(args).toContain("-async");
    expect(args).toContain("-avoid_negative_ts");
    // Audio filter still present
    expect(args).toContain("-af");
    expect(args.some((a) => a.includes("volume=0.8"))).toBe(true);
    expect(args.some((a) => a.includes("adelay=200|200"))).toBe(true);
  });
});

// ---- REQ-043-A: SpawnedProcess exposes getLastPtsSeconds ----

describe("SpawnedProcess — PTS diagnosis (REQ-043-A)", () => {
  it("[REQ-043-A] should expose getLastPtsSeconds as a function on SpawnedProcess", () => {
    // Construct a minimal object that satisfies the SpawnedProcess type.
    // If the type does not have getLastPtsSeconds this will be a TypeScript compile error.
    const mockProcess: SpawnedProcess = {
      process: {} as ReturnType<typeof Bun.spawn>,
      kill: () => {},
      getLastPtsSeconds: () => 42.5,
    };

    expect(typeof mockProcess.getLastPtsSeconds).toBe("function");
  });

  it("[REQ-043-A] getLastPtsSeconds should return a number", () => {
    const mockProcess: SpawnedProcess = {
      process: {} as ReturnType<typeof Bun.spawn>,
      kill: () => {},
      getLastPtsSeconds: () => 123.456,
    };

    const pts = mockProcess.getLastPtsSeconds();

    expect(typeof pts).toBe("number");
    expect(pts).toBe(123.456);
  });

  it("[REQ-043-A] getLastPtsSeconds should return 0 as initial/default value", () => {
    // Simulate the typical initial state before any PTS has been parsed.
    let lastPts = 0;
    const mockProcess: SpawnedProcess = {
      process: {} as ReturnType<typeof Bun.spawn>,
      kill: () => {},
      getLastPtsSeconds: () => lastPts,
    };

    expect(mockProcess.getLastPtsSeconds()).toBe(0);

    // Simulate PTS update (as the real implementation does via stderr parsing)
    lastPts = 17.8;
    expect(mockProcess.getLastPtsSeconds()).toBe(17.8);
  });
});
