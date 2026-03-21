/**
 * /pause — Toggle pause/resume of the current stream.
 *
 * Referenced by: REQ-013
 */
import type { SyncController } from "../sync/sync-controller";

type StreamControlLike = {
  pauseChannelStream: (channelId: number) => boolean;
  resumeChannelStream: (channelId: number) => boolean;
  isActive?: (channelId: number) => boolean;
};

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
  syncController: SyncController,
  streamControl?: StreamControlLike
): void => {
  ctx.commands.register({
    name: "vid_pause",
    description: "Pause or resume the current video",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to pause.");
      }

      const isPlaying = syncController.isPlaying(channelId);
      const hasActiveStream = streamControl?.isActive?.(channelId) ?? false;
      if (!isPlaying && !hasActiveStream) {
        return "Nothing is currently playing.";
      }

      const currentlyPaused = syncController.isPaused(channelId);
      if (currentlyPaused) {
        const resumed = streamControl?.resumeChannelStream(channelId) ?? true;
        if (!resumed) {
          throw new Error("Could not resume stream: no active stream resources found.");
        }
        syncController.setPaused(channelId, false);
        return "Resumed playback.";
      }

      const paused = streamControl?.pauseChannelStream(channelId) ?? true;
      if (!paused) {
        throw new Error("Could not pause stream: no active stream resources found.");
      }

      syncController.setPaused(channelId, true);
      return "Paused playback.";
    },
  });
};
