/**
 * Unit tests for QueueManager.
 *
 * TDD: These tests were written BEFORE the implementation.
 * Each test references its requirement ID.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { QueueManager } from "../../src/queue/queue-manager";
import type { QueueItem } from "../../src/queue/types";

const makeItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: overrides.id ?? crypto.randomUUID(),
  query: overrides.query ?? "https://youtube.com/watch?v=test",
  title: overrides.title ?? "Test Video",
  youtubeUrl: overrides.youtubeUrl ?? "https://youtube.com/watch?v=test",
  videoProfileLevelId: overrides.videoProfileLevelId ?? "",
  streamUrl: overrides.streamUrl ?? "https://stream.example.com/test",
  audioUrl: overrides.audioUrl ?? "https://audio.example.com/test",
  duration: overrides.duration ?? 120,
  thumbnail: overrides.thumbnail ?? "https://img.example.com/thumb.jpg",
  addedBy: overrides.addedBy ?? 1,
  addedAt: overrides.addedAt ?? Date.now(),
});

describe("QueueManager", () => {
  let queue: QueueManager;
  const channelId = 42;

  beforeEach(() => {
    queue = new QueueManager();
  });

  // --- REQ-004: Videos können in eine Warteschlange eingereiht werden ---

  it("[REQ-004] should add a video to the queue", () => {
    const item = makeItem({ title: "Video A" });
    queue.add(channelId, item);
    const state = queue.getState(channelId);
    expect(state.size).toBe(1);
  });

  it("[REQ-004] should add multiple videos to the queue in order", () => {
    const a = makeItem({ title: "Video A" });
    const b = makeItem({ title: "Video B" });
    const c = makeItem({ title: "Video C" });

    queue.add(channelId, a);
    queue.add(channelId, b);
    queue.add(channelId, c);

    const state = queue.getState(channelId);
    expect(state.size).toBe(3);
    expect(state.current?.title).toBe("Video A");
    expect(state.upcoming[0]?.title).toBe("Video B");
    expect(state.upcoming[1]?.title).toBe("Video C");
  });

  it("[REQ-004] should reject adding when queue is at max size", () => {
    // Fill queue to max
    for (let i = 0; i < 50; i++) {
      queue.add(channelId, makeItem({ title: `Video ${i}` }));
    }
    expect(() => queue.add(channelId, makeItem())).toThrow();
  });

  // --- REQ-005: Warteschlange ist pro Voice-Channel isoliert ---

  it("[REQ-005] should isolate queues per channel", () => {
    const channelA = 1;
    const channelB = 2;

    queue.add(channelA, makeItem({ title: "Channel A Video" }));
    queue.add(channelB, makeItem({ title: "Channel B Video" }));

    const stateA = queue.getState(channelA);
    const stateB = queue.getState(channelB);

    expect(stateA.size).toBe(1);
    expect(stateA.current?.title).toBe("Channel A Video");
    expect(stateB.size).toBe(1);
    expect(stateB.current?.title).toBe("Channel B Video");
  });

  it("[REQ-005] clearing one channel should not affect another", () => {
    const channelA = 1;
    const channelB = 2;

    queue.add(channelA, makeItem({ title: "A" }));
    queue.add(channelB, makeItem({ title: "B" }));

    queue.clear(channelA);

    expect(queue.getState(channelA).size).toBe(0);
    expect(queue.getState(channelB).size).toBe(1);
  });

  // --- REQ-006: Warteschlange kann angezeigt werden ---

  it("[REQ-006] should return the full queue state", () => {
    queue.add(channelId, makeItem({ title: "Current" }));
    queue.add(channelId, makeItem({ title: "Next" }));
    queue.add(channelId, makeItem({ title: "After" }));

    const state = queue.getState(channelId);

    expect(state.current).not.toBeNull();
    expect(state.current?.title).toBe("Current");
    expect(state.upcoming).toHaveLength(2);
    expect(state.upcoming[0]?.title).toBe("Next");
    expect(state.upcoming[1]?.title).toBe("After");
    expect(state.size).toBe(3);
  });

  it("[REQ-006] should return empty state for unknown channel", () => {
    const state = queue.getState(999);
    expect(state.current).toBeNull();
    expect(state.upcoming).toHaveLength(0);
    expect(state.size).toBe(0);
  });

  // --- REQ-007: Videos können aus der Warteschlange entfernt werden ---

  it("[REQ-007] should remove a video by position (1-based)", () => {
    queue.add(channelId, makeItem({ title: "A" }));
    queue.add(channelId, makeItem({ title: "B" }));
    queue.add(channelId, makeItem({ title: "C" }));

    const removed = queue.remove(channelId, 2); // Remove "B" (upcoming[0])

    expect(removed?.title).toBe("B");
    const state = queue.getState(channelId);
    expect(state.size).toBe(2);
    expect(state.current?.title).toBe("A");
    expect(state.upcoming[0]?.title).toBe("C");
  });

  it("[REQ-007] should remove the current video (position 1) and advance", () => {
    queue.add(channelId, makeItem({ title: "A" }));
    queue.add(channelId, makeItem({ title: "B" }));

    const removed = queue.remove(channelId, 1);

    expect(removed?.title).toBe("A");
    const state = queue.getState(channelId);
    expect(state.current?.title).toBe("B");
    expect(state.size).toBe(1);
  });

  it("[REQ-007] should return null for invalid position", () => {
    queue.add(channelId, makeItem({ title: "A" }));

    expect(queue.remove(channelId, 0)).toBeNull();
    expect(queue.remove(channelId, 5)).toBeNull();
    expect(queue.remove(channelId, -1)).toBeNull();
  });

  // --- REQ-008: Aktuelles Video kann übersprungen werden ---

  it("[REQ-008] should skip to the next video in queue", () => {
    queue.add(channelId, makeItem({ title: "A" }));
    queue.add(channelId, makeItem({ title: "B" }));
    queue.add(channelId, makeItem({ title: "C" }));

    const next = queue.skip(channelId);

    expect(next?.title).toBe("B");
    const state = queue.getState(channelId);
    expect(state.current?.title).toBe("B");
    expect(state.upcoming).toHaveLength(1);
    expect(state.upcoming[0]?.title).toBe("C");
  });

  it("[REQ-008] should return null when skipping empty queue", () => {
    expect(queue.skip(channelId)).toBeNull();
  });

  it("[REQ-008] should return null when skipping the last video", () => {
    queue.add(channelId, makeItem({ title: "Only" }));

    const next = queue.skip(channelId);

    expect(next).toBeNull();
    expect(queue.getState(channelId).current).toBeNull();
    expect(queue.getState(channelId).size).toBe(0);
  });

  // --- REQ-009: Auto-Advance callback ---

  it("[REQ-009] should call onAdvance callback when skip is called", () => {
    let advancedTo: QueueItem | null = null;
    let advancedChannel: number | null = null;

    queue.onAdvance((next, chId) => {
      advancedTo = next;
      advancedChannel = chId;
    });

    queue.add(channelId, makeItem({ title: "A" }));
    queue.add(channelId, makeItem({ title: "B" }));
    queue.skip(channelId);

    expect(advancedTo?.title).toBe("B");
    expect(advancedChannel).toBe(channelId);
  });

  it("[REQ-009] should call onAdvance with null when queue exhausted", () => {
    let advancedTo: QueueItem | null | undefined = undefined;

    queue.onAdvance((next) => {
      advancedTo = next;
    });

    queue.add(channelId, makeItem({ title: "A" }));
    queue.skip(channelId);

    expect(advancedTo).toBeNull();
  });

  // --- REQ-010: Clear queue ---

  it("[REQ-010] should clear all items from a channel queue", () => {
    queue.add(channelId, makeItem({ title: "A" }));
    queue.add(channelId, makeItem({ title: "B" }));

    queue.clear(channelId);

    const state = queue.getState(channelId);
    expect(state.current).toBeNull();
    expect(state.upcoming).toHaveLength(0);
    expect(state.size).toBe(0);
  });

  // --- Edge cases ---

  it("should return current item without mutating state", () => {
    const item = makeItem({ title: "Current" });
    queue.add(channelId, item);

    const current1 = queue.getCurrent(channelId);
    const current2 = queue.getCurrent(channelId);

    expect(current1?.title).toBe("Current");
    expect(current2?.title).toBe("Current");
  });

  it("should handle rapid add/remove/skip operations", () => {
    for (let i = 0; i < 10; i++) {
      queue.add(channelId, makeItem({ title: `Video ${i}` }));
    }

    queue.skip(channelId); // Remove 0, current = 1
    queue.remove(channelId, 3); // Remove position 3
    queue.skip(channelId); // Remove 1, current = 2

    const state = queue.getState(channelId);
    expect(state.size).toBe(7);
  });
});
