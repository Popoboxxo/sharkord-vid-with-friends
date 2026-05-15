/**
 * Plugin-level singletons (initialized in onLoad).
 *
 * Centralized to avoid circular imports between src/index.ts
 * and feature modules.
 */
import { QueueManager } from "../queue/queue-manager";
import { StreamManager } from "../stream/stream-manager";
import { SyncController } from "../sync/sync-controller";

export let queueManager: QueueManager;
export let streamManager: StreamManager;
export let syncController: SyncController;

export function setQueueManager(qm: QueueManager): void {
  queueManager = qm;
}

export function setStreamManager(sm: StreamManager): void {
  streamManager = sm;
}

export function setSyncController(sc: SyncController): void {
  syncController = sc;
}
