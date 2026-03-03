/**
 * Integration test — Plugin lifecycle + Queue-Stream orchestration.
 *
 * Tests the full flow: commands → queueManager → syncController → stream lifecycle.
 * Uses mock context (no real ffmpeg/yt-dlp).
 *
 * Referenced by: REQ-004, REQ-008, REQ-009, REQ-010, REQ-015, REQ-016
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { createMockPluginContext, type MockPluginContext, type TInvokerContext } from "./mock-plugin-context";
import { QueueManager } from "../../src/queue/queue-manager";
import { SyncController } from "../../src/sync/sync-controller";
import type { QueueItem } from "../../src/queue/types";
import { registerPlayCommand } from "../../src/commands/play";
import { registerQueueCommand } from "../../src/commands/queue";
import { registerSkipCommand } from "../../src/commands/skip";
import { registerRemoveCommand } from "../../src/commands/remove";
import { registerStopCommand } from "../../src/commands/stop";
import { registerNowPlayingCommand } from "../../src/commands/nowplaying";
import { registerPauseCommand } from "../../src/commands/pause";
import { registerResumeCommand } from "../../src/commands/resume";
import { registerVolumeCommand } from "../../src/commands/volume";

// ---- Helpers ----

const CHANNEL_ID = 100;
const USER_ID = 1;

const makeInvoker = (overrides: Partial<TInvokerContext> = {}): TInvokerContext => ({
  userId: overrides.userId ?? USER_ID,
  currentVoiceChannelId: "currentVoiceChannelId" in overrides
    ? overrides.currentVoiceChannelId
    : CHANNEL_ID,
});

/** Create a fake QueueItem for testing (bypasses yt-dlp). */
const fakeItem = (title: string, index = 0): QueueItem => ({
  id: `fake-${index}-${Date.now()}`,
  query: `test query ${index}`,
  title,
  youtubeUrl: "https://youtube.com/watch?v=test",
  streamUrl: `https://example.com/stream/${index}`,
  audioUrl: `https://example.com/audio/${index}`,
  duration: 180 + index * 30,
  thumbnail: `https://example.com/thumb/${index}.jpg`,
  addedBy: USER_ID,
  addedAt: Date.now(),
});

// ---- Test Suite ----

describe("Integration: Queue + SyncController + Commands", () => {
  let ctx: MockPluginContext;
  let queueManager: QueueManager;
  let syncController: SyncController;
  let startedStreams: Array<{ channelId: number; item: QueueItem }>;

  beforeEach(() => {
    ctx = createMockPluginContext();
    queueManager = new QueueManager();
    startedStreams = [];

    // Mock startStream function — records calls instead of spawning ffmpeg
    const mockStartStream = async (channelId: number, item: QueueItem): Promise<void> => {
      startedStreams.push({ channelId, item });
    };

    syncController = new SyncController(queueManager, mockStartStream);

    // Register all commands
    registerPlayCommand(ctx as never, queueManager, syncController);
    registerQueueCommand(ctx as never, queueManager);
    registerSkipCommand(ctx as never, syncController);
    registerRemoveCommand(ctx as never, queueManager);
    registerStopCommand(ctx as never, syncController);
    registerNowPlayingCommand(ctx as never, queueManager);
    registerPauseCommand(ctx as never, syncController);
    registerResumeCommand(ctx as never, syncController);
    registerVolumeCommand(ctx as never, syncController);
  });

  // ---- REQ-015: Plugin lifecycle ----

  it("[REQ-015] should register all 9 commands", () => {
    expect(ctx.commands.registered.size).toBe(9);
    expect(ctx.commands.registered.has("watch")).toBe(true);
    expect(ctx.commands.registered.has("queue")).toBe(true);
    expect(ctx.commands.registered.has("skip")).toBe(true);
    expect(ctx.commands.registered.has("remove")).toBe(true);
    expect(ctx.commands.registered.has("watch_stop")).toBe(true);
    expect(ctx.commands.registered.has("nowplaying")).toBe(true);
    expect(ctx.commands.registered.has("pause")).toBe(true);
    expect(ctx.commands.registered.has("resume")).toBe(true);
    expect(ctx.commands.registered.has("volume")).toBe(true);
  });

  // ---- REQ-004 + REQ-006: Queue flow ----

  it("[REQ-004] should add videos to queue and show them via /queue", async () => {
    const invoker = makeInvoker();

    // Manually add items (bypassing yt-dlp resolution in /watch)
    queueManager.add(CHANNEL_ID, fakeItem("Video A", 0));
    syncController.setPlaying(CHANNEL_ID, true);
    queueManager.add(CHANNEL_ID, fakeItem("Video B", 1));
    queueManager.add(CHANNEL_ID, fakeItem("Video C", 2));

    // Check queue via command
    const result = await ctx.commands.execute("queue", invoker, {});
    expect(result).toContain("Video A");
    expect(result).toContain("Video B");
    expect(result).toContain("Video C");
  });

  // ---- REQ-008: Skip flow ----

  it("[REQ-008] should skip to next video and trigger stream start", async () => {
    const invoker = makeInvoker();

    // Set up queue with 2 items
    queueManager.add(CHANNEL_ID, fakeItem("First Video", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Second Video", 1));
    syncController.setPlaying(CHANNEL_ID, true);

    // Skip
    await ctx.commands.execute("skip", invoker, {});

    // SyncController should have called startStream with the second video
    expect(startedStreams.length).toBe(1);
    expect(startedStreams[0].channelId).toBe(CHANNEL_ID);
    expect(startedStreams[0].item.title).toBe("Second Video");
  });

  it("[REQ-008] should stop playing when skipping the last video", async () => {
    const invoker = makeInvoker();

    queueManager.add(CHANNEL_ID, fakeItem("Only Video", 0));
    syncController.setPlaying(CHANNEL_ID, true);

    await ctx.commands.execute("skip", invoker, {});

    expect(syncController.isPlaying(CHANNEL_ID)).toBe(false);
    expect(startedStreams.length).toBe(0);
  });

  // ---- REQ-009: Auto-advance ----

  it("[REQ-009] should auto-advance when current video ends", async () => {
    queueManager.add(CHANNEL_ID, fakeItem("Video 1", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Video 2", 1));
    syncController.setPlaying(CHANNEL_ID, true);

    // Simulate video end
    await syncController.onVideoEnded(CHANNEL_ID);

    expect(startedStreams.length).toBe(1);
    expect(startedStreams[0].item.title).toBe("Video 2");
    expect(syncController.isPlaying(CHANNEL_ID)).toBe(true);
  });

  it("[REQ-009] should stop playing when queue is exhausted after auto-advance", async () => {
    queueManager.add(CHANNEL_ID, fakeItem("Last Video", 0));
    syncController.setPlaying(CHANNEL_ID, true);

    await syncController.onVideoEnded(CHANNEL_ID);

    expect(startedStreams.length).toBe(0);
    expect(syncController.isPlaying(CHANNEL_ID)).toBe(false);
  });

  it("[REQ-009] should not auto-advance when paused", async () => {
    queueManager.add(CHANNEL_ID, fakeItem("Video 1", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Video 2", 1));
    syncController.setPlaying(CHANNEL_ID, true);
    syncController.setPaused(CHANNEL_ID, true);

    await syncController.onVideoEnded(CHANNEL_ID);

    expect(startedStreams.length).toBe(0);
  });

  // ---- REQ-010: Stop flow ----

  it("[REQ-010] should stop playback and clear queue via /watch_stop", async () => {
    const invoker = makeInvoker();

    queueManager.add(CHANNEL_ID, fakeItem("Video A", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Video B", 1));
    syncController.setPlaying(CHANNEL_ID, true);

    await ctx.commands.execute("watch_stop", invoker, {});

    expect(syncController.isPlaying(CHANNEL_ID)).toBe(false);
    expect(queueManager.getState(CHANNEL_ID).size).toBe(0);
  });

  // ---- REQ-007: Remove flow ----

  it("[REQ-007] should remove a video from queue by position", async () => {
    const invoker = makeInvoker();

    queueManager.add(CHANNEL_ID, fakeItem("Video A", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Video B", 1));
    queueManager.add(CHANNEL_ID, fakeItem("Video C", 2));
    syncController.setPlaying(CHANNEL_ID, true);

    // Remove position 2 (0-indexed: Video B, the first upcoming)
    await ctx.commands.execute("remove", invoker, { position: 2 });

    const state = queueManager.getState(CHANNEL_ID);
    expect(state.size).toBe(2);
    expect(state.upcoming.length).toBe(1);
    expect(state.upcoming[0].title).toBe("Video C");
  });

  // ---- REQ-013: Pause/Resume flow ----

  it("[REQ-013] should toggle pause state via /pause", async () => {
    const invoker = makeInvoker();

    syncController.setPlaying(CHANNEL_ID, true);
    expect(syncController.isPaused(CHANNEL_ID)).toBe(false);

    await ctx.commands.execute("pause", invoker, {});
    expect(syncController.isPaused(CHANNEL_ID)).toBe(true);

    await ctx.commands.execute("pause", invoker, {});
    expect(syncController.isPaused(CHANNEL_ID)).toBe(false);
  });

  // ---- REQ-012: Volume flow ----

  it("[REQ-012] should set volume via /volume", async () => {
    const invoker = makeInvoker();

    await ctx.commands.execute("volume", invoker, { level: 75 });
    expect(syncController.getVolume(CHANNEL_ID)).toBe(75);

    await ctx.commands.execute("volume", invoker, { level: 0 });
    expect(syncController.getVolume(CHANNEL_ID)).toBe(0);
  });

  // ---- REQ-016: Cleanup on voice close ----

  it("[REQ-016] should cleanup state when syncController.cleanupChannel is called", () => {
    queueManager.add(CHANNEL_ID, fakeItem("Video", 0));
    syncController.setPlaying(CHANNEL_ID, true);
    syncController.setVolume(CHANNEL_ID, 80);

    // Simulate cleanup
    syncController.cleanupChannel(CHANNEL_ID);
    queueManager.clear(CHANNEL_ID);

    expect(syncController.isPlaying(CHANNEL_ID)).toBe(false);
    expect(syncController.getVolume(CHANNEL_ID)).toBe(75); // back to default
    expect(queueManager.getState(CHANNEL_ID).size).toBe(0);
  });

  // ---- Multi-channel isolation (REQ-005) ----

  it("[REQ-005] should isolate state between channels", async () => {
    const channelA = 200;
    const channelB = 300;

    queueManager.add(channelA, fakeItem("Channel A Video", 0));
    queueManager.add(channelB, fakeItem("Channel B Video", 1));
    syncController.setPlaying(channelA, true);
    syncController.setVolume(channelA, 80);
    syncController.setPlaying(channelB, true);
    syncController.setVolume(channelB, 30);

    // Skip on channel A
    await syncController.skip(channelA);

    // Channel A stopped (no more videos)
    expect(syncController.isPlaying(channelA)).toBe(false);

    // Channel B unaffected
    expect(syncController.isPlaying(channelB)).toBe(true);
    expect(syncController.getVolume(channelB)).toBe(30);
    expect(queueManager.getState(channelB).size).toBe(1);
  });

  // ---- Full flow: add → play → skip → auto-advance → stop ----

  it("[REQ-004, REQ-008, REQ-009, REQ-010] full playback lifecycle", async () => {
    // 1. Add 3 videos
    queueManager.add(CHANNEL_ID, fakeItem("Song 1", 0));
    queueManager.add(CHANNEL_ID, fakeItem("Song 2", 1));
    queueManager.add(CHANNEL_ID, fakeItem("Song 3", 2));
    syncController.setPlaying(CHANNEL_ID, true);

    expect(queueManager.getState(CHANNEL_ID).current?.title).toBe("Song 1");

    // 2. Skip to song 2
    await syncController.skip(CHANNEL_ID);
    expect(startedStreams.length).toBe(1);
    expect(startedStreams[0].item.title).toBe("Song 2");

    // 3. Song 2 ends → auto-advance to Song 3
    startedStreams.length = 0;
    await syncController.onVideoEnded(CHANNEL_ID);
    expect(startedStreams.length).toBe(1);
    expect(startedStreams[0].item.title).toBe("Song 3");

    // 4. Song 3 ends → queue exhausted
    startedStreams.length = 0;
    await syncController.onVideoEnded(CHANNEL_ID);
    expect(startedStreams.length).toBe(0);
    expect(syncController.isPlaying(CHANNEL_ID)).toBe(false);
  });
});
