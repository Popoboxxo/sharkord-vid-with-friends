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
      execute: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
};

export const registerStopCommand = (
  ctx: PluginContextLike,
  syncController: SyncController,
  streamManager?: StreamManager
): void => {
  ctx.commands.register({
    name: "vid-stop",
    description: "Stop the current video and clear the queue",
    execute: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to stop playback.");
      }

      const isPlaying = syncController.isPlaying(channelId);
      const hasActiveStream = streamManager?.isActive(channelId) ?? false;
      if (!isPlaying && !hasActiveStream) {
        return "Nothing is currently playing.";
      }

      // Kill all ffmpeg processes and close streams (REQ-010)
      streamManager?.cleanup(channelId);

      // Sweep any orphaned temp files from crashes or previous sessions (REQ-037)
      streamManager?.sweepOrphanedTempFiles();

      // Clear queue and sync state
      syncController.stop(channelId);

      return "Playback stopped and queue cleared.";
    },
  });
};

