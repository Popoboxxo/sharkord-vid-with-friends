/**
 * /vid-history — Show the last played videos for the caller's voice channel.
 */
import type { QueueManager } from "../queue/queue-manager";

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

export const registerHistoryCommand = (
  ctx: PluginContextLike,
  queueManager: QueueManager
): void => {
  ctx.commands.register({
    name: "vid-history",
    description: "Show the last 10 played videos",
    execute: async (invoker) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel.");
      }

      const history = queueManager.getHistory(channelId);
      if (history.length === 0) {
        return "No videos have been played yet.";
      }

      const lines = history.map((item, index) => {
        const duration = item.duration
          ? ` (${formatDuration(item.duration)})`
          : "";
        return `${index + 1}. ${item.title}${duration}`;
      });

      return `Last ${history.length} played:\n${lines.join("\n")}`;
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
