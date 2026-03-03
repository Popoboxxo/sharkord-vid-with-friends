/**
 * /debug_cache — Shows downloaded video/audio cache files.
 * 
 * Lists all cached video/audio files from yt-dlp downloads in debug mode.
 * Cache files are written to ~/.config/sharkord/vid-with-friends-cache/
 *
 * Referenced by: REQ-032, REQ-033
 */
import path from "path";
import { readdirSync, statSync } from "fs";

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
  settings?: {
    get?: <T = unknown>(key: string) => T | undefined;
  };
};

export const registerDebugCacheCommand = (ctx: PluginContextLike): void => {
  ctx.commands.register<Record<string, never>>({
    name: "debug_cache",
    description: "List debug cache files (video/audio) for inspection",
    args: [],
    executes: async (_invoker, _args) => {
      const debugEnabled = ctx.settings?.get?.<boolean>("debugMode") ?? false;
      if (!debugEnabled) {
        throw new Error("Debug Output is disabled. Enable debugMode in plugin settings before using /debug_cache.");
      }

      const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
      const cacheDir = path.join(homeDir, ".config", "sharkord", "vid-with-friends-cache");

      try {
        const files = readdirSync(cacheDir);
        
        if (files.length === 0) {
          throw new Error(
            `Debug cache directory is empty (checked: ${cacheDir}).\n` +
            "Run /watch with Debug Output enabled to create cache files."
          );
        }

        // Sort by mod time (newest first)
        const fileStats = files
          .map((f) => {
            const fullPath = path.join(cacheDir, f);
            const stat = statSync(fullPath);
            return { name: f, bytes: stat.size, mtime: stat.mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);

        // Format as readable message
        const lines: string[] = [
          "📁 **Debug Cache Files** (newest first):",
          "",
        ];

        for (const file of fileStats) {
          const sizeKb = (file.bytes / 1024).toFixed(1);
          const date = new Date(file.mtime).toISOString().slice(0, 19);
          lines.push(`✅ \`${file.name}\` — ${sizeKb} KB (${date})`);
        }

        lines.push("");
        lines.push(
          "💾 **Note:** These files are cached in `./debug-cache/` (host) " +
          "and `/root/.config/sharkord/vid-with-friends-cache/` (container)."
        );
        lines.push(
          "📥 Download them from `./debug-cache/` to inspect the raw stream data."
        );

        return lines.join("\n");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `Cache directory not found: ${cacheDir}\n` +
            "Create it by running /watch with Debug Output enabled."
          );
        }
        throw err;
      }
    },
  });
};
