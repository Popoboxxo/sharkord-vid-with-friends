/**
 * Voice runtime event handlers.
 */
import type { PluginContext } from "../utils/settings";
import { streamManager, syncController, queueManager } from "../utils/plugin-state";

/**
 * Handle voice:runtime_closed — clean up ALL resources for that channel. (REQ-016)
 */
export const handleVoiceRuntimeClosed = (ctx: PluginContext) => {
  return (...args: unknown[]) => {
    const event = args[0] as { channelId?: number } | undefined;
    const channelId = event?.channelId;

    if (!channelId) {
      ctx.debug("[lifecycle] voice:runtime_closed fired without channelId");
      return;
    }

    ctx.log(`[lifecycle] Voice runtime closed for channel ${channelId}, cleaning up...`);

    streamManager.cleanup(channelId);
    streamManager.sweepOrphanedTempFiles();
    syncController.cleanupChannel(channelId);
    queueManager.clear(channelId);
  };
};
