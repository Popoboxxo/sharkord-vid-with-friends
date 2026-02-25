/**
 * Integration test — real streaming pipeline against a live YouTube URL.
 *
 * This test is gated by RUN_STREAMING_TESTS=1 and requires binaries in src/stream/bin.
 * It validates that yt-dlp resolves the URL and ffmpeg processes stay alive for a short period.
 *
 * Referenced by: REQ-002
 */
import { describe, it, expect } from "bun:test";
import {
  buildVideoStreamArgs,
  buildAudioStreamArgs,
  spawnFfmpeg,
  getFfmpegPath,
} from "../../src/stream/ffmpeg";
import { resolveVideo, getYtDlpPath } from "../../src/stream/yt-dlp";

const STREAM_TEST_URL = "https://www.youtube.com/watch?v=H6P3kJ8nrR8";
const RUN_STREAMING_TESTS = process.env.RUN_STREAMING_TESTS === "1";

const loggers = {
  log: (..._messages: unknown[]) => {},
  debug: (..._messages: unknown[]) => {},
  error: (..._messages: unknown[]) => {},
};

const binariesAvailable = async (): Promise<boolean> => {
  const ffmpegExists = await Bun.file(getFfmpegPath()).exists();
  const ytDlpExists = await Bun.file(getYtDlpPath()).exists();
  return ffmpegExists && ytDlpExists;
};

describe("Integration: Streaming (real URL)", () => {
  it("[REQ-002] should stream video+audio for at least 5s", async () => {
    if (!RUN_STREAMING_TESTS) return;
    if (!(await binariesAvailable())) return;

    const resolved = await resolveVideo(STREAM_TEST_URL, loggers);

    expect(resolved.youtubeUrl).toContain("youtube.com");
    expect(resolved.streamUrl.length).toBeGreaterThan(0);
    expect(resolved.audioUrl.length).toBeGreaterThan(0);

    const videoArgs = buildVideoStreamArgs({
      sourceUrl: resolved.streamUrl,
      rtpHost: "127.0.0.1",
      rtpPort: 45000,
      payloadType: 96,
      ssrc: 111111111,
      bitrate: "2000k",
    });

    const audioArgs = buildAudioStreamArgs({
      sourceUrl: resolved.audioUrl,
      rtpHost: "127.0.0.1",
      rtpPort: 45002,
      payloadType: 111,
      ssrc: 222222222,
      bitrate: "128k",
      volume: 0.5,
    });

    const videoProc = spawnFfmpeg(videoArgs, loggers, resolved.streamUrl, resolved.youtubeUrl, "video", false);
    const audioProc = spawnFfmpeg(audioArgs, loggers, resolved.audioUrl, resolved.youtubeUrl, "audio", false);

    await new Promise<void>((resolve) => setTimeout(resolve, 5000));

    expect(videoProc.process.exitCode).toBeNull();
    expect(audioProc.process.exitCode).toBeNull();

    videoProc.kill();
    audioProc.kill();
  });
});
