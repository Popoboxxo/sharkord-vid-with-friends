/**
 * Stream watchdog — monitors ffmpeg process health per channel.
 *
 * Referenced by: REQ-044
 */
import type { ChannelStreamResources } from "../types/stream";

export type WatchdogOptions = {
  expectedDurationSeconds: number;
  loggers: { log: (...m: unknown[]) => void; error: (...m: unknown[]) => void };
  onPrematureExit: (retryCount: number) => Promise<void>;
  onFatalExit: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
};

export class StreamWatchdog {
  private readonly intervals = new Map<number, ReturnType<typeof setInterval>>();

  start(channelId: number, getResources: (id: number) => ChannelStreamResources | undefined, options: WatchdogOptions): void {
    this.stop(channelId);

    const {
      expectedDurationSeconds,
      loggers,
      onPrematureExit,
      onFatalExit,
      maxRetries = 2,
      retryDelayMs = 3000,
      pollIntervalMs = 5000,
    } = options;

    const startTimeMs = Date.now();
    let retryCount = 0;
    let active = true;

    loggers.log("[watchdog] Started — expectedDuration=", `${expectedDurationSeconds}s`, `maxRetries=${maxRetries}`);

    const interval = setInterval(async () => {
      if (!active) return;

      const resources = getResources(channelId);
      if (!resources) {
        clearInterval(interval);
        this.intervals.delete(channelId);
        active = false;
        return;
      }

      const { videoProcess, audioProcess } = resources;
      const videoExitCode = videoProcess?.process.exitCode ?? null;
      const audioExitCode = audioProcess?.process.exitCode ?? null;
      const videoAlive = videoExitCode === null;
      const audioAlive = audioExitCode === null;

      if (videoAlive && audioAlive) return;

      const elapsedMs = Date.now() - startTimeMs;
      const elapsedSeconds = elapsedMs / 1000;
      const normalEndWindowSeconds = 10;
      const isNormalEnd =
        (videoExitCode === 0 || videoExitCode === null) &&
        (audioExitCode === 0 || audioExitCode === null) &&
        expectedDurationSeconds > 0 &&
        Math.abs(elapsedSeconds - expectedDurationSeconds) <= normalEndWindowSeconds;

      if (isNormalEnd) {
        loggers.log("[watchdog] Normal end detected — elapsed=", `${Math.round(elapsedSeconds)}s`, "expected=", `${expectedDurationSeconds}s`);
        clearInterval(interval);
        this.intervals.delete(channelId);
        active = false;
        return;
      }

      loggers.error(
        "[watchdog] ALARM: premature process exit —",
        `elapsed=${Math.round(elapsedSeconds)}s`,
        `expected=${expectedDurationSeconds}s`,
        `video.exitCode=${videoExitCode}`,
        `audio.exitCode=${audioExitCode}`,
        `retryCount=${retryCount}/${maxRetries}`
      );

      if (retryCount >= maxRetries) {
        loggers.error("[watchdog] Max retries exhausted — triggering fatal exit handler");
        clearInterval(interval);
        this.intervals.delete(channelId);
        active = false;
        onFatalExit();
        return;
      }

      retryCount += 1;
      loggers.log(`[watchdog] Scheduling retry ${retryCount}/${maxRetries} in ${retryDelayMs}ms...`);

      active = false;
      clearInterval(interval);
      this.intervals.delete(channelId);

      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));

      try {
        await onPrematureExit(retryCount);
      } catch (err) {
        loggers.error("[watchdog] onPrematureExit callback threw:", err instanceof Error ? err.message : String(err));
      }
    }, pollIntervalMs);

    this.intervals.set(channelId, interval);
  }

  stop(channelId: number): void {
    const existing = this.intervals.get(channelId);
    if (existing) {
      clearInterval(existing);
      this.intervals.delete(channelId);
    }
  }

  stopAll(): void {
    for (const [id, interval] of this.intervals) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }
}
