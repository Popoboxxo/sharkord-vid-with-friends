/**
 * Unit tests for SyncController.
 *
 * TDD: Tests written BEFORE implementation.
 *
 * Referenced by: REQ-003, REQ-008, REQ-009, REQ-010, REQ-013
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { SyncController } from "../../src/sync/sync-controller";
import { QueueManager } from "../../src/queue/queue-manager";
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

// Mock the startStream function so we don't actually spawn ffmpeg
const createMockStartStream = () => {
  const calls: { channelId: number; item: QueueItem }[] = [];
  return {
    calls,
    fn: async (channelId: number, item: QueueItem) => {
      calls.push({ channelId, item });
    },
  };
};

describe("SyncController", () => {
  let syncController: SyncController;
  let queueManager: QueueManager;
  let mockStartStream: ReturnType<typeof createMockStartStream>;
  const channelId = 42;

  beforeEach(() => {
    queueManager = new QueueManager();
    mockStartStream = createMockStartStream();
    syncController = new SyncController(queueManager, mockStartStream.fn);
  });

  // --- REQ-003: Channel sync state ---

  it("[REQ-003] should track playing state per channel", () => {
    expect(syncController.isPlaying(channelId)).toBe(false);

    syncController.setPlaying(channelId, true);
    expect(syncController.isPlaying(channelId)).toBe(true);

    syncController.setPlaying(channelId, false);
    expect(syncController.isPlaying(channelId)).toBe(false);
  });

  // --- REQ-003: play() starts stream for current item ---

  it("[REQ-003] should start stream for current queue item via play()", async () => {
    const item = makeItem({ title: "Play Me" });
    queueManager.add(channelId, item);

    await syncController.play(channelId);

    expect(syncController.isPlaying(channelId)).toBe(true);
    expect(mockStartStream.calls).toHaveLength(1);
    expect(mockStartStream.calls[0]?.item.title).toBe("Play Me");
  });

  it("[REQ-003] should throw when play() called on empty queue", async () => {
    expect(syncController.play(channelId)).rejects.toThrow("Queue is empty");
  });

  // --- REQ-008: Skip triggers next video ---

  it("[REQ-008] should skip to next video and start stream", async () => {
    queueManager.add(channelId, makeItem({ title: "Video A" }));
    queueManager.add(channelId, makeItem({ title: "Video B" }));
    syncController.setPlaying(channelId, true);

    await syncController.skip(channelId);

    // Queue should have advanced
    const state = queueManager.getState(channelId);
    expect(state.current?.title).toBe("Video B");

    // Start stream should have been called for the new video
    expect(mockStartStream.calls).toHaveLength(1);
    expect(mockStartStream.calls[0]?.item.title).toBe("Video B");
  });

  it("[REQ-008] should stop when skipping the last video", async () => {
    queueManager.add(channelId, makeItem({ title: "Only Video" }));
    syncController.setPlaying(channelId, true);

    await syncController.skip(channelId);

    expect(syncController.isPlaying(channelId)).toBe(false);
    expect(mockStartStream.calls).toHaveLength(0);
  });

  // --- REQ-009: Auto-advance ---

  it("[REQ-009] should auto-advance to next video when current ends", async () => {
    queueManager.add(channelId, makeItem({ title: "Video A" }));
    queueManager.add(channelId, makeItem({ title: "Video B" }));
    syncController.setPlaying(channelId, true);

    await syncController.onVideoEnded(channelId);

    expect(mockStartStream.calls).toHaveLength(1);
    expect(mockStartStream.calls[0]?.item.title).toBe("Video B");
  });

  it("[REQ-009] should stop playing when no more videos in queue", async () => {
    queueManager.add(channelId, makeItem({ title: "Only Video" }));
    syncController.setPlaying(channelId, true);

    await syncController.onVideoEnded(channelId);

    expect(syncController.isPlaying(channelId)).toBe(false);
    expect(mockStartStream.calls).toHaveLength(0);
  });

  it("[REQ-009] should not auto-advance when not playing", async () => {
    queueManager.add(channelId, makeItem({ title: "A" }));
    queueManager.add(channelId, makeItem({ title: "B" }));

    await syncController.onVideoEnded(channelId);

    expect(mockStartStream.calls).toHaveLength(0);
  });

  // --- REQ-010: Stop ---

  it("[REQ-010] should stop playing and clear queue", () => {
    queueManager.add(channelId, makeItem({ title: "Video A" }));
    queueManager.add(channelId, makeItem({ title: "Video B" }));
    syncController.setPlaying(channelId, true);

    syncController.stop(channelId);

    expect(syncController.isPlaying(channelId)).toBe(false);
    expect(queueManager.getState(channelId).size).toBe(0);
  });

  // --- REQ-013: Pause/Resume ---

  it("[REQ-013] should track paused state", () => {
    expect(syncController.isPaused(channelId)).toBe(false);

    syncController.setPaused(channelId, true);
    expect(syncController.isPaused(channelId)).toBe(true);

    syncController.setPaused(channelId, false);
    expect(syncController.isPaused(channelId)).toBe(false);
  });

  it("[REQ-013] should not auto-advance while paused", async () => {
    queueManager.add(channelId, makeItem({ title: "A" }));
    queueManager.add(channelId, makeItem({ title: "B" }));
    syncController.setPlaying(channelId, true);
    syncController.setPaused(channelId, true);

    await syncController.onVideoEnded(channelId);

    // Should not advance while paused
    expect(mockStartStream.calls).toHaveLength(0);
  });

  // --- REQ-016: Cleanup for channel ---

  it("[REQ-016] should cleanup state for a channel", () => {
    syncController.setPlaying(channelId, true);
    syncController.setPaused(channelId, true);

    syncController.cleanupChannel(channelId);

    expect(syncController.isPlaying(channelId)).toBe(false);
    expect(syncController.isPaused(channelId)).toBe(false);
  });

  it("[REQ-016] should cleanup all channels", () => {
    syncController.setPlaying(1, true);
    syncController.setPlaying(2, true);
    syncController.setPlaying(3, true);

    syncController.cleanupAll();

    expect(syncController.isPlaying(1)).toBe(false);
    expect(syncController.isPlaying(2)).toBe(false);
    expect(syncController.isPlaying(3)).toBe(false);
  });

  // --- Edge cases ---

  it("should handle skip on non-existent channel gracefully", async () => {
    await expect(syncController.skip(999)).resolves.toBeUndefined();
  });

  it("should handle volume state per channel", () => {
    syncController.setVolume(channelId, 75);
    expect(syncController.getVolume(channelId)).toBe(75);

    syncController.setVolume(channelId, 0);
    expect(syncController.getVolume(channelId)).toBe(0);
  });

  it("should default volume to 75", () => {
    expect(syncController.getVolume(channelId)).toBe(75);
  });
});
