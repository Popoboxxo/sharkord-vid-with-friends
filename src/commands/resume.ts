/**
 * /resume — Resume a paused stream.
 *
 * Referenced by: REQ-034
 */
import type { SyncController } from "../sync/sync-controller";

type StreamControlLike = {
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

export const registerResumeCommand = (
  ctx: PluginContextLike,
  syncController: SyncController,
  streamControl?: StreamControlLike
): void => {
  ctx.commands.register({
    name: "resume",
    description: "Resume a paused video",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to resume.");
      }

      const isPlaying = syncController.isPlaying(channelId);
      const hasActiveStream = streamControl?.isActive?.(channelId) ?? false;
      if (!isPlaying && !hasActiveStream) {
        return "Nothing is currently playing.";
      }

      if (!syncController.isPaused(channelId)) {
        return "No paused video to resume.";
      }

      const resumed = streamControl?.resumeChannelStream(channelId) ?? true;
      if (!resumed) {
        throw new Error("Could not resume stream: no active stream resources found.");
      }

      syncController.setPaused(channelId, false);
      return "Resumed playback.";
    },
  });
};
