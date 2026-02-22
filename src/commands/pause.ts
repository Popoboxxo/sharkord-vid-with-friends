/**
 * /pause — Toggle pause/resume of the current stream.
 *
 * Referenced by: REQ-013
 */
import type { SyncController } from "../sync/sync-controller";

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

export const registerPauseCommand = (
  ctx: PluginContextLike,
  syncController: SyncController
): void => {
  ctx.commands.register({
    name: "pause",
    description: "Pause or resume the current video",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to pause.");
      }

      if (!syncController.isPlaying(channelId)) {
        return "Nothing is currently playing.";
      }

      const currentlyPaused = syncController.isPaused(channelId);
      syncController.setPaused(channelId, !currentlyPaused);

      return currentlyPaused ? "Resumed playback." : "Paused playback.";
    },
  });
};
