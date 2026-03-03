/**
 * /skip — Skip the current video and play the next in queue.
 *
 * Referenced by: REQ-008
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

export const registerSkipCommand = (
  ctx: PluginContextLike,
  syncController: SyncController,
  streamManager?: StreamManager
): void => {
  ctx.commands.register({
    name: "skip",
    description: "Skip the current video",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to skip.");
      }

      const isPlaying = syncController.isPlaying(channelId);
      const hasActiveStream = streamManager?.isActive(channelId) ?? false;
      if (!isPlaying && !hasActiveStream) {
        return "Nothing is currently playing.";
      }

      await syncController.skip(channelId);
      return "Skipped.";
    },
  });
};
