/**
 * QueueManager — manages per-channel video queues.
 *
 * Pure logic, no Sharkord dependencies. Fully testable.
 *
 * Referenced by: REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010
 */
import type { QueueItem, QueueState, QueueAdvanceCallback } from "./types";
import { MAX_QUEUE_SIZE } from "../utils/constants";

type ChannelQueue = {
  items: QueueItem[];
  currentIndex: number;
};

export class QueueManager {
  private readonly queues = new Map<number, ChannelQueue>();
  private advanceCallbacks: QueueAdvanceCallback[] = [];

  /** Register a callback that fires whenever a queue advances (skip/remove current). */
  onAdvance(callback: QueueAdvanceCallback): void {
    this.advanceCallbacks.push(callback);
  }

  /** Add a video to a channel's queue. Throws if queue is full. (REQ-004) */
  add(channelId: number, item: QueueItem): void {
    const queue = this.getOrCreateQueue(channelId);
    if (queue.items.length >= MAX_QUEUE_SIZE) {
      throw new Error(`Queue is full (max ${MAX_QUEUE_SIZE} items). Remove some videos first.`);
    }
    queue.items.push(item);
  }

  /**
   * Remove a video by 1-based position. (REQ-007)
   * Position 1 = current, 2 = first upcoming, etc.
   * If current is removed, the queue advances.
   * Returns the removed item or null if position is invalid.
   */
  remove(channelId: number, position: number): QueueItem | null {
    const queue = this.queues.get(channelId);
    if (!queue) return null;

    const index = queue.currentIndex + position - 1;
    if (position < 1 || index >= queue.items.length) return null;

    const [removed] = queue.items.splice(index, 1);
    if (!removed) return null;

    // If we removed the current item, adjust currentIndex
    if (position === 1) {
      // currentIndex stays the same, but the item at that index is now the next one
      // If we're past the end, there's nothing left
      const next = this.getCurrent(channelId);
      this.emitAdvance(next, channelId);
    }

    return removed;
  }

  /**
   * Skip the current video and advance to the next. (REQ-008)
   * Returns the new current item, or null if queue is exhausted.
   */
  skip(channelId: number): QueueItem | null {
    const queue = this.queues.get(channelId);
    if (!queue) return null;

    queue.currentIndex++;

    const next = this.getCurrent(channelId);
    this.emitAdvance(next, channelId);

    // Clean up if queue is exhausted
    if (!next) {
      this.clear(channelId);
    }

    return next;
  }

  /** Get the currently playing item for a channel. */
  getCurrent(channelId: number): QueueItem | null {
    const queue = this.queues.get(channelId);
    if (!queue) return null;
    return queue.items[queue.currentIndex] ?? null;
  }

  /**
   * Get the full queue state for a channel. (REQ-006)
   * Returns current item, upcoming items, and total size.
   */
  getState(channelId: number): QueueState {
    const queue = this.queues.get(channelId);
    if (!queue || queue.currentIndex >= queue.items.length) {
      return { current: null, upcoming: [], size: 0 };
    }

    const current = queue.items[queue.currentIndex] ?? null;
    const upcoming = queue.items.slice(queue.currentIndex + 1);
    const size = current ? 1 + upcoming.length : 0;

    return { current, upcoming, size };
  }

  /** Clear a channel's queue entirely. (REQ-010) */
  clear(channelId: number): void {
    this.queues.delete(channelId);
  }

  /** Check if a channel has any items in queue. */
  hasItems(channelId: number): boolean {
    return this.getState(channelId).size > 0;
  }

  // ---- Private helpers ----

  private getOrCreateQueue(channelId: number): ChannelQueue {
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = { items: [], currentIndex: 0 };
      this.queues.set(channelId, queue);
    }
    return queue;
  }

  private emitAdvance(next: QueueItem | null, channelId: number): void {
    for (const cb of this.advanceCallbacks) {
      try {
        cb(next, channelId);
      } catch {
        // Don't let callback errors break the queue
      }
    }
  }
}
