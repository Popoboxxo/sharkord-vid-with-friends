/**
 * SyncController — orchestrates queue, stream, and playback state per channel.
 *
 * Manages the "what plays when" logic:
 * - Starting streams when a video is requested
 * - Auto-advancing to the next video when current one ends (REQ-009)
 * - Handling skip, stop, pause/resume
 * - Per-channel volume tracking
 *
 * Referenced by: REQ-003, REQ-008, REQ-009, REQ-010, REQ-013, REQ-016
 */
import type { QueueManager } from "../queue/queue-manager";
import type { QueueItem } from "../queue/types";
import { DEFAULT_SETTINGS } from "../utils/constants";

// ---- Types ----

type ChannelSyncState = {
  isPlaying: boolean;
  isPaused: boolean;
  volume: number;
};

/** Function signature for starting a stream (injected dependency for testability) */
export type StartStreamFn = (channelId: number, item: QueueItem) => Promise<void>;

// ---- SyncController ----

export class SyncController {
  private readonly states = new Map<number, ChannelSyncState>();
  private readonly queueManager: QueueManager;
  private readonly startStream: StartStreamFn;

  constructor(queueManager: QueueManager, startStream: StartStreamFn) {
    this.queueManager = queueManager;
    this.startStream = startStream;
  }

  // ---- State accessors ----

  /** Check if a channel is currently playing. (REQ-003) */
  isPlaying(channelId: number): boolean {
    return this.getState(channelId).isPlaying;
  }

  /** Set the playing state for a channel. */
  setPlaying(channelId: number, playing: boolean): void {
    this.getOrCreateState(channelId).isPlaying = playing;
  }

  /** Check if a channel is paused. (REQ-013) */
  isPaused(channelId: number): boolean {
    return this.getState(channelId).isPaused;
  }

  /** Set the paused state for a channel. (REQ-013) */
  setPaused(channelId: number, paused: boolean): void {
    this.getOrCreateState(channelId).isPaused = paused;
  }

  /** Get the volume for a channel (0-100). (REQ-012) */
  getVolume(channelId: number): number {
    return this.getState(channelId).volume;
  }

  /** Set the volume for a channel (0-100). (REQ-012) */
  setVolume(channelId: number, volume: number): void {
    this.getOrCreateState(channelId).volume = Math.min(100, Math.max(0, volume));
  }

  // ---- Actions ----

  /**
   * Skip the current video and start the next one. (REQ-008)
   * If there's no next video, stops playback.
   */
  async skip(channelId: number): Promise<void> {
    const next = this.queueManager.skip(channelId);

    if (next) {
      await this.startStream(channelId, next);
    } else {
      this.setPlaying(channelId, false);
    }
  }

  /**
   * Called when the current video's ffmpeg process ends. (REQ-009)
   * Auto-advances to the next video if playing and not paused.
   */
  async onVideoEnded(channelId: number): Promise<void> {
    const state = this.getState(channelId);
    if (!state.isPlaying || state.isPaused) return;

    const next = this.queueManager.skip(channelId);

    if (next) {
      await this.startStream(channelId, next);
    } else {
      this.setPlaying(channelId, false);
    }
  }

  /**
   * Stop playback entirely and clear the queue. (REQ-010)
   */
  stop(channelId: number): void {
    this.setPlaying(channelId, false);
    this.setPaused(channelId, false);
    this.queueManager.clear(channelId);
  }

  // ---- Cleanup ----

  /** Clean up sync state for a channel. (REQ-016) */
  cleanupChannel(channelId: number): void {
    this.states.delete(channelId);
  }

  /** Clean up all channel states. (REQ-016) */
  cleanupAll(): void {
    this.states.clear();
  }

  // ---- Private helpers ----

  private getState(channelId: number): ChannelSyncState {
    return this.states.get(channelId) ?? {
      isPlaying: false,
      isPaused: false,
      volume: DEFAULT_SETTINGS.DEFAULT_VOLUME,
    };
  }

  private getOrCreateState(channelId: number): ChannelSyncState {
    let state = this.states.get(channelId);
    if (!state) {
      state = {
        isPlaying: false,
        isPaused: false,
        volume: DEFAULT_SETTINGS.DEFAULT_VOLUME,
      };
      this.states.set(channelId, state);
    }
    return state;
  }
}
