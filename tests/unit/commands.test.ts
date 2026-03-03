/**
 * Unit tests for all Commands.
 *
 * TDD: Tests written BEFORE implementation.
 * Tests command registration and execution via mock PluginContext.
 *
 * Referenced by: REQ-001, REQ-006, REQ-007, REQ-008, REQ-010, REQ-011, REQ-012, REQ-013
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { QueueManager } from "../../src/queue/queue-manager";
import { SyncController } from "../../src/sync/sync-controller";
import { registerPlayCommand } from "../../src/commands/play";
import { registerQueueCommand } from "../../src/commands/queue";
import { registerSkipCommand } from "../../src/commands/skip";
import { registerRemoveCommand } from "../../src/commands/remove";
import { registerStopCommand } from "../../src/commands/stop";
import { registerNowPlayingCommand } from "../../src/commands/nowplaying";
import { registerPauseCommand } from "../../src/commands/pause";
import { registerResumeCommand } from "../../src/commands/resume";
import { registerVolumeCommand } from "../../src/commands/volume";
import { registerDebugCacheCommand } from "../../src/commands/debug_cache";
import {
  createMockPluginContext,
  type MockPluginContext,
  type TInvokerContext,
} from "../integration/mock-plugin-context";
import type { QueueItem } from "../../src/queue/types";

const makeItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: overrides.id ?? crypto.randomUUID(),
  query: overrides.query ?? "https://youtube.com/watch?v=test",
  title: overrides.title ?? "Test Video",
  youtubeUrl: overrides.youtubeUrl ?? "https://youtube.com/watch?v=test",
  streamUrl: overrides.streamUrl ?? "https://stream.example.com/test",
  audioUrl: overrides.audioUrl ?? "https://audio.example.com/test",
  duration: overrides.duration ?? 120,
  thumbnail: overrides.thumbnail ?? "https://img.example.com/thumb.jpg",
  addedBy: overrides.addedBy ?? 1,
  addedAt: overrides.addedAt ?? Date.now(),
});

const makeInvoker = (overrides: Partial<TInvokerContext> = {}): TInvokerContext => ({
  userId: overrides.userId ?? 1,
  currentVoiceChannelId: "currentVoiceChannelId" in overrides
    ? overrides.currentVoiceChannelId
    : 42,
});

describe("Commands", () => {
  let ctx: MockPluginContext;
  let queueManager: QueueManager;
  let syncController: SyncController;
  let streamControl: { pauseChannelStream: (channelId: number) => boolean; resumeChannelStream: (channelId: number) => boolean };
  let pausedChannelId: number | null;
  let resumedChannelId: number | null;
  const channelId = 42;

  // Mock the actual stream starting (we don't need ffmpeg for command tests)
  const mockStartStream = async (_channelId: number, _item: QueueItem) => {};

  beforeEach(() => {
    ctx = createMockPluginContext();
    queueManager = new QueueManager();
    syncController = new SyncController(queueManager, mockStartStream);
    pausedChannelId = null;
    resumedChannelId = null;
    streamControl = {
      pauseChannelStream: (id: number) => {
        pausedChannelId = id;
        return true;
      },
      resumeChannelStream: (id: number) => {
        resumedChannelId = id;
        return true;
      },
    };
  });

  // --- REQ-001: /watch command ---

  describe("/watch", () => {
    it("[REQ-001] should register the watch command", () => {
      registerPlayCommand(ctx as never, queueManager, syncController);
      expect(ctx.commands.registered.has("watch")).toBe(true);
    });

    it("[REQ-001] should throw when not in a voice channel", async () => {
      registerPlayCommand(ctx as never, queueManager, syncController);
      const invoker = makeInvoker({ currentVoiceChannelId: undefined });
      await expect(
        ctx.commands.execute("watch", invoker, { query: "test" })
      ).rejects.toThrow("voice channel");
    });

    it("[REQ-001] should throw when no query provided", async () => {
      registerPlayCommand(ctx as never, queueManager, syncController);
      const invoker = makeInvoker();
      await expect(
        ctx.commands.execute("watch", invoker, { query: "" })
      ).rejects.toThrow();
    });

    it("[REQ-035] should reject starting a second video when one is already active", async () => {
      registerPlayCommand(ctx as never, queueManager, syncController);
      syncController.setPlaying(channelId, true);

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("watch", invoker, { query: "test" });

      expect(String(result)).toContain("already playing");
      expect(queueManager.getState(channelId).size).toBe(0);
    });
  });

  // --- REQ-006: /queue command ---

  describe("/queue", () => {
    it("[REQ-006] should register the queue command", () => {
      registerQueueCommand(ctx as never, queueManager);
      expect(ctx.commands.registered.has("queue")).toBe(true);
    });

    it("[REQ-006] should return empty queue message", async () => {
      registerQueueCommand(ctx as never, queueManager);
      const invoker = makeInvoker();
      const result = await ctx.commands.execute("queue", invoker, {});
      expect(result).toContain("empty");
    });

    it("[REQ-006] should list queued videos", async () => {
      registerQueueCommand(ctx as never, queueManager);
      queueManager.add(channelId, makeItem({ title: "Video A" }));
      queueManager.add(channelId, makeItem({ title: "Video B" }));

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("queue", invoker, {});
      const resultStr = String(result);
      expect(resultStr).toContain("Video A");
      expect(resultStr).toContain("Video B");
    });
  });

  // --- REQ-008: /skip command ---

  describe("/skip", () => {
    it("[REQ-008] should register the skip command", () => {
      registerSkipCommand(ctx as never, syncController);
      expect(ctx.commands.registered.has("skip")).toBe(true);
    });

    it("[REQ-008] should throw when not in a voice channel", async () => {
      registerSkipCommand(ctx as never, syncController);
      const invoker = makeInvoker({ currentVoiceChannelId: undefined });
      await expect(
        ctx.commands.execute("skip", invoker, {})
      ).rejects.toThrow("voice channel");
    });

    it("[REQ-008] should skip when stream is active even if sync state is false", async () => {
      const streamManagerLike = {
        isActive: (id: number) => id === channelId,
      };
      registerSkipCommand(ctx as never, syncController, streamManagerLike as never);

      queueManager.add(channelId, makeItem({ title: "Video A" }));
      queueManager.add(channelId, makeItem({ title: "Video B" }));
      syncController.setPlaying(channelId, false);

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("skip", invoker, {});

      expect(String(result)).toContain("Skipped");
    });
  });

  // --- REQ-007: /remove command ---

  describe("/remove", () => {
    it("[REQ-007] should register the remove command", () => {
      registerRemoveCommand(ctx as never, queueManager);
      expect(ctx.commands.registered.has("remove")).toBe(true);
    });

    it("[REQ-007] should throw when not in a voice channel", async () => {
      registerRemoveCommand(ctx as never, queueManager);
      const invoker = makeInvoker({ currentVoiceChannelId: undefined });
      await expect(
        ctx.commands.execute("remove", invoker, { position: 1 })
      ).rejects.toThrow("voice channel");
    });

    it("[REQ-007] should return error for invalid position", async () => {
      registerRemoveCommand(ctx as never, queueManager);
      const invoker = makeInvoker();
      const result = await ctx.commands.execute("remove", invoker, { position: 99 });
      expect(String(result)).toContain("Invalid");
    });

    it("[REQ-007] should remove video at given position", async () => {
      registerRemoveCommand(ctx as never, queueManager);
      queueManager.add(channelId, makeItem({ title: "A" }));
      queueManager.add(channelId, makeItem({ title: "B" }));
      queueManager.add(channelId, makeItem({ title: "C" }));

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("remove", invoker, { position: 2 });
      expect(String(result)).toContain("B");
      expect(queueManager.getState(channelId).size).toBe(2);
    });
  });

  // --- REQ-010: /watch_stop command ---

  describe("/watch_stop", () => {
    it("[REQ-010] should register the watch_stop command", () => {
      registerStopCommand(ctx as never, syncController);
      expect(ctx.commands.registered.has("watch_stop")).toBe(true);
    });

    it("[REQ-010] should stop playback", async () => {
      registerStopCommand(ctx as never, syncController);
      syncController.setPlaying(channelId, true);
      queueManager.add(channelId, makeItem());

      const invoker = makeInvoker();
      await ctx.commands.execute("watch_stop", invoker, {});

      expect(syncController.isPlaying(channelId)).toBe(false);
    });

    it("[REQ-010] should stop when stream is active even if sync state is false", async () => {
      let cleanedChannel: number | null = null;
      const streamManagerLike = {
        isActive: (id: number) => id === channelId,
        cleanup: (id: number) => {
          cleanedChannel = id;
        },
      };

      registerStopCommand(ctx as never, syncController, streamManagerLike as never);
      syncController.setPlaying(channelId, false);
      queueManager.add(channelId, makeItem());

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("watch_stop", invoker, {});

      expect(String(result)).toContain("Playback stopped");
      expect(cleanedChannel).toBe(channelId);
    });
  });

  // --- REQ-011: /nowplaying command ---

  describe("/nowplaying", () => {
    it("[REQ-011] should register the nowplaying command", () => {
      registerNowPlayingCommand(ctx as never, queueManager);
      expect(ctx.commands.registered.has("nowplaying")).toBe(true);
    });

    it("[REQ-011] should show nothing playing when queue is empty", async () => {
      registerNowPlayingCommand(ctx as never, queueManager);
      const invoker = makeInvoker();
      const result = await ctx.commands.execute("nowplaying", invoker, {});
      expect(String(result)).toContain("Nothing");
    });

    it("[REQ-011] should show current video title", async () => {
      registerNowPlayingCommand(ctx as never, queueManager);
      queueManager.add(channelId, makeItem({ title: "Cool Video" }));

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("nowplaying", invoker, {});
      expect(String(result)).toContain("Cool Video");
    });
  });

  // --- REQ-013: /pause command ---

  describe("/pause", () => {
    it("[REQ-013] should register the pause command", () => {
      registerPauseCommand(ctx as never, syncController, streamControl);
      expect(ctx.commands.registered.has("pause")).toBe(true);
    });

    it("[REQ-013] should toggle pause state", async () => {
      registerPauseCommand(ctx as never, syncController, streamControl);
      syncController.setPlaying(channelId, true);

      const invoker = makeInvoker();

      await ctx.commands.execute("pause", invoker, {});
      expect(syncController.isPaused(channelId)).toBe(true);
      expect(pausedChannelId).toBe(channelId);

      await ctx.commands.execute("pause", invoker, {});
      expect(syncController.isPaused(channelId)).toBe(false);
      expect(resumedChannelId).toBe(channelId);
    });

    it("[REQ-013] should pause when stream is active even if sync state is false", async () => {
      const streamControlWithActive = {
        ...streamControl,
        isActive: (id: number) => id === channelId,
      };

      registerPauseCommand(ctx as never, syncController, streamControlWithActive);
      syncController.setPlaying(channelId, false);

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("pause", invoker, {});

      expect(String(result)).toContain("Paused playback");
      expect(pausedChannelId).toBe(channelId);
      expect(syncController.isPaused(channelId)).toBe(true);
    });
  });

  // --- REQ-034: /resume command ---

  describe("/resume", () => {
    it("[REQ-034] should register the resume command", () => {
      registerResumeCommand(ctx as never, syncController, streamControl);
      expect(ctx.commands.registered.has("resume")).toBe(true);
    });

    it("[REQ-034] should return helpful message when no video is paused", async () => {
      registerResumeCommand(ctx as never, syncController, streamControl);
      syncController.setPlaying(channelId, true);
      syncController.setPaused(channelId, false);

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("resume", invoker, {});

      expect(String(result)).toContain("No paused video");
    });

    it("[REQ-034] should resume a paused video", async () => {
      registerResumeCommand(ctx as never, syncController, streamControl);
      syncController.setPlaying(channelId, true);
      syncController.setPaused(channelId, true);

      const invoker = makeInvoker();
      const result = await ctx.commands.execute("resume", invoker, {});

      expect(String(result)).toContain("Resumed playback");
      expect(syncController.isPaused(channelId)).toBe(false);
      expect(resumedChannelId).toBe(channelId);
    });
  });

  // --- REQ-012: /volume command ---

  describe("/volume", () => {
    it("[REQ-012] should register the volume command", () => {
      registerVolumeCommand(ctx as never, syncController);
      expect(ctx.commands.registered.has("volume")).toBe(true);
    });

    it("[REQ-012] should set volume", async () => {
      registerVolumeCommand(ctx as never, syncController);
      const invoker = makeInvoker();

      await ctx.commands.execute("volume", invoker, { level: 75 });
      expect(syncController.getVolume(channelId)).toBe(75);
    });

    it("[REQ-012] should reject invalid volume levels", async () => {
      registerVolumeCommand(ctx as never, syncController);
      const invoker = makeInvoker();

      await expect(
        ctx.commands.execute("volume", invoker, { level: 150 })
      ).rejects.toThrow();

      await expect(
        ctx.commands.execute("volume", invoker, { level: -10 })
      ).rejects.toThrow();
    });
  });

  // --- REQ-033: /debug_cache command ---

  describe("/debug_cache", () => {
    it("[REQ-033] should register the debug_cache command", () => {
      registerDebugCacheCommand(ctx as never);
      expect(ctx.commands.registered.has("debug_cache")).toBe(true);
    });

    it("[REQ-033] should reject when debug mode is disabled", async () => {
      registerDebugCacheCommand(ctx as never);
      const invoker = makeInvoker();

      await expect(
        ctx.commands.execute("debug_cache", invoker, {})
      ).rejects.toThrow("Debug Output is disabled");
    });
  });
});
