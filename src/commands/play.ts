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
      let resolved;
      try {
        resolved = await resolveVideo(sourceUrl, {
          log: (...m) => ctx.log(...m),
          debug: (...m) => ctx.debug(...m),
          error: (...m) => ctx.error(...m),
        });
        ctx.log(`[watch] Resolved: "${resolved.title}" (${resolved.duration}s)`);
        ctx.debug(`[watch] Video URL: ${resolved.streamUrl.substring(0, 100)}...`);
        ctx.debug(`[watch] Audio URL: ${resolved.audioUrl.substring(0, 100)}...`);
      } catch (err) {
        ctx.error(`[watch] Failed to resolve video:`, err);
        throw new Error(`Failed to resolve video. Check server logs for details.`);
      }

      if (!resolved.streamUrl) {
        ctx.error(`[watch] No stream URL found for: ${sourceUrl}`);
        throw new Error("Could not find a playable stream URL for this video.");
      }

      const item = {
        id: crypto.randomUUID(),
        query: args.query,
        title: resolved.title,
        youtubeUrl: resolved.youtubeUrl,
        streamUrl: resolved.streamUrl,
        audioUrl: resolved.audioUrl || resolved.streamUrl,  // Fallback to streamUrl if no separate audio
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
      try {
        await syncController.play(channelId);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        ctx.error(`[watch] Failed to start stream:`, errorMsg);
        if (errorStack) ctx.error(`[watch] Stack:`, errorStack);
        queueManager.remove(channelId, 1);
        throw new Error(`Failed to start stream: ${errorMsg}`);
      }
      return `Now playing: ${resolved.title}`;
    },
  });
};
