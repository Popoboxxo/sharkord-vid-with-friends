/**
 * /watch_stop — Stop playback and clear the queue.
 *
 * Referenced by: REQ-010
 */
import type { SyncController } from "../sync/sync-controller";
import type { StreamManager } from "../stream/stream-manager";

type PluginContextLike = {
  commands: {
    register: <TArgs = void>(command: {
      name: string;
      description?: string;
      args?: { name: string; description?: string; type: string; required?: boolean }[];
      executes: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
};

export const registerStopCommand = (
  ctx: PluginContextLike,
  syncController: SyncController,
  streamManager: StreamManager
): void => {
  ctx.commands.register({
    name: "watch_stop",
    description: "Stop the current video and clear the queue",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to stop playback.");
      }

      if (!syncController.isPlaying(channelId)) {
        return "Nothing is currently playing.";
      }

      // Kill all ffmpeg processes and close streams (REQ-010)
      streamManager.cleanup(channelId);
      
      // Clear queue and sync state
      syncController.stop(channelId);
      
      return "Playback stopped and queue cleared.";
    },
  });
};
