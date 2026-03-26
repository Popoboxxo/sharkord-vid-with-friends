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
    name: "vid-watch",
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

      if (syncController.isPlaying(channelId)) {
        return "A video is already playing in this channel. Use /vid-stop to stop it first.";
      }

      let sourceUrl = args.query.trim();
      const queryDisplay = args.query.trim();

      // Convert plain search terms to yt-search format
      if (!isYouTubeUrl(sourceUrl) && !/^https?:\/\//.test(sourceUrl)) {
        sourceUrl = `ytsearch:${sourceUrl}`;
      }

      ctx.log(`[watch] Resolving: ${sourceUrl}`);

      // REQ-046/UX: Resolve and stream entirely in background — return immediately so the user
      // gets instant feedback without waiting 5–15s for yt-dlp to resolve the video.
      (async () => {
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
          return;
        }

        if (!resolved.streamUrl) {
          ctx.error(`[watch] No stream URL found for: ${sourceUrl}`);
          return;
        }

        const item = {
          id: crypto.randomUUID(),
          query: args.query,
          title: resolved.title,
          youtubeUrl: resolved.youtubeUrl,
          streamUrl: resolved.streamUrl,
          audioUrl: resolved.audioUrl || resolved.streamUrl,
          videoFormatId: resolved.videoFormatId,
          audioFormatId: resolved.audioFormatId,
          duration: resolved.duration,
          thumbnail: resolved.thumbnail,
          addedBy: invoker.userId,
          addedAt: Date.now(),
        };

        queueManager.add(channelId, item);

        syncController.play(channelId).catch((err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          ctx.error(`[watch] Failed to start stream:`, errorMsg);
          queueManager.remove(channelId, 1);
        });
      })();

      // REQ-046: Instant feedback — user sees this immediately, before resolve completes
      const isSearch = sourceUrl.startsWith("ytsearch:");
      return isSearch
        ? `Searching for "${queryDisplay}"... Bot will appear in channel shortly.`
        : `Loading video... Bot will appear in channel shortly.`;
    },
  });
};
