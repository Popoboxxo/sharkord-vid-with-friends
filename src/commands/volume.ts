/**
 * /volume <0-100> — Set the playback volume.
 *
 * Referenced by: REQ-012
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

export const registerVolumeCommand = (
  ctx: PluginContextLike,
  syncController: SyncController
): void => {
  ctx.commands.register<{ level: number }>({
    name: "volume",
    description: "Set the playback volume (0-100)",
    args: [
      {
        name: "level",
        description: "Volume level from 0 to 100",
        type: "number",
        required: true,
      },
    ],
    executes: async (invoker, args) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to set volume.");
      }

      if (args.level < 0 || args.level > 100) {
        throw new Error("Volume must be between 0 and 100.");
      }

      syncController.setVolume(channelId, args.level);
      return `Volume set to ${args.level}%. Applies to the next video.`;
    },
  });
};
