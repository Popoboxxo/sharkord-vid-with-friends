/**
 * /queue — Display the current video queue for the voice channel.
 *
 * Referenced by: REQ-006
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

export const registerQueueCommand = (
  ctx: PluginContextLike,
  queueManager: QueueManager
): void => {
  ctx.commands.register({
    name: "queue",
    description: "Show the current video queue",
    executes: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to view the queue.");
      }

      const state = queueManager.getState(channelId);

      if (state.size === 0) {
        return "The queue is empty. Use /watch to add a video.";
      }

      const lines: string[] = [];

      if (state.current) {
        const duration = state.current.duration
          ? ` (${formatDuration(state.current.duration)})`
          : "";
        lines.push(`▶ Now playing: ${state.current.title}${duration}`);
      }

      if (state.upcoming.length > 0) {
        lines.push("");
        lines.push("Up next:");
        for (let i = 0; i < state.upcoming.length; i++) {
          const item = state.upcoming[i]!;
          const duration = item.duration ? ` (${formatDuration(item.duration)})` : "";
          lines.push(`  ${i + 2}. ${item.title}${duration}`);
        }
      }

      lines.push("");
      lines.push(`${state.size} video${state.size !== 1 ? "s" : ""} in queue`);

      return lines.join("\n");
    },
  });
};

/** Format seconds as MM:SS or HH:MM:SS */
const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
};
