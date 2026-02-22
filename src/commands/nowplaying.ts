/**
 * /nowplaying — Show the currently playing video.
 *
 * Referenced by: REQ-011
 */
import type { QueueManager } from "../queue/queue-manager";

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

export const registerNowPlayingCommand = (
  ctx: PluginContextLike,
  queueManager: QueueManager
): void => {
  ctx.commands.register({
    name: "nowplaying",
    description: "Show the currently playing video",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel.");
      }

      const current = queueManager.getCurrent(channelId);
      if (!current) {
        return "Nothing is currently playing.";
      }

      const duration = current.duration
        ? ` (${formatDuration(current.duration)})`
        : "";
      return `Now playing: ${current.title}${duration}`;
    },
  });
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
};
