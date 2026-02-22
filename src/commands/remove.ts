/**
 * /remove <position> — Remove a video from the queue by position.
 *
 * Referenced by: REQ-007
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

export const registerRemoveCommand = (
  ctx: PluginContextLike,
  queueManager: QueueManager
): void => {
  ctx.commands.register<{ position: number }>({
    name: "remove",
    description: "Remove a video from the queue by position",
    args: [
      {
        name: "position",
        description: "Position in the queue (use /queue to see positions)",
        type: "number",
        required: true,
      },
    ],
    executes: async (invoker, args) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to remove videos.");
      }

      const removed = queueManager.remove(channelId, args.position);
      if (!removed) {
        return "Invalid position. Use /queue to see the current queue.";
      }

      return `Removed: ${removed.title}`;
    },
  });
};
