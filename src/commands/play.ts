/**
 * /watch <url|query> — Play a YouTube video in the voice channel.
 *
 * If a video is already playing, adds to queue instead.
 * Supports YouTube URLs, youtu.be short links, and search queries.
 *
 * Referenced by: REQ-001, REQ-004
 */
import type { QueueManager } from "../queue/queue-manager";
import type { SyncController } from "../sync/sync-controller";
import { isYouTubeUrl, resolveVideo } from "../stream/yt-dlp";

type PluginContextLike = {
  commands: {
    register: <TArgs = void>(command: {
      name: string;
      description?: string;
      args?: { name: string; description?: string; type: string; required?: boolean }[];
      executes: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export const registerPlayCommand = (
  ctx: PluginContextLike,
  queueManager: QueueManager,
  syncController: SyncController
): void => {
  ctx.commands.register<{ query: string }>({
    name: "watch",
    description: "Play a YouTube video in the voice channel",
    args: [
      {
        name: "query",
        description: "YouTube URL or search query",
        type: "string",
        required: true,
      },
    ],
    executes: async (invoker, args) => {
      const channelId = invoker.currentVoiceChannelId;
      if (!channelId) {
        throw new Error("You must be in a voice channel to watch videos.");
      }

      if (!args.query || !args.query.trim()) {
        throw new Error("Please provide a YouTube URL or search query.");
      }

      let sourceUrl = args.query.trim();

      // Convert plain search terms to yt-search format
      if (!isYouTubeUrl(sourceUrl) && !/^https?:\/\//.test(sourceUrl)) {
        sourceUrl = `ytsearch:${sourceUrl}`;
      }

      ctx.log(`[watch] Resolving: ${sourceUrl}`);

      // Resolve video info via yt-dlp
      const resolved = await resolveVideo(sourceUrl, {
        log: (...m) => ctx.log(...m),
        debug: (...m) => ctx.debug(...m),
        error: (...m) => ctx.error(...m),
      });

      const item = {
        id: crypto.randomUUID(),
        query: args.query,
        title: resolved.title,
        streamUrl: resolved.streamUrl,
        duration: resolved.duration,
        thumbnail: resolved.thumbnail,
        addedBy: invoker.userId,
        addedAt: Date.now(),
      };

      queueManager.add(channelId, item);

      // If already playing, just add to queue
      if (syncController.isPlaying(channelId)) {
        const state = queueManager.getState(channelId);
        return `Added to queue (#${state.size}): ${resolved.title}`;
      }

      // Otherwise start playing immediately
      syncController.setPlaying(channelId, true);
      return `Now playing: ${resolved.title}`;
    },
  });
};
