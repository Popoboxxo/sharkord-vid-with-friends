/**
 * Debug logging utilities.
 */
import type { PluginContext } from "./settings";

/**
 * Log debug messages only if debug mode is enabled.
 * Requires a PluginContext with settings access.
 */
export const debugLog = (ctx: PluginContext, prefix: string, ...messages: unknown[]): void => {
  try {
    const debugMode = Boolean(ctx.settings?.get?.("debugMode") ?? false);
    if (debugMode) {
      ctx.log(`[DEBUG] ${prefix}`, ...messages);
    }
  } catch {
    // Silently fail if settings not available
  }
};

/**
 * Format plugin settings for debug output with visual separation (REQ-026-A).
 * Only called when debugMode=true.
 */
export const debugLogFormattedSettings = (
  ctx: PluginContext,
  effective: {
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    defaultVolume: number;
    syncMode: string;
    fullDownloadMode: boolean;
    debugMode: boolean;
  }
): void => {
  ctx.log(
    `\n${"═".repeat(70)}\n` +
    `║ 🎬 PLUGIN SETTINGS (Debug Mode Active)\n` +
    `${"═".repeat(70)}\n` +
    `║ 🎥 Video Bitrate:        ${effective.videoBitrateKbps} kbps\n` +
    `║ 🔊 Audio Bitrate:        ${effective.audioBitrateKbps} kbps\n` +
    `║ 🔉 Volume:               ${effective.defaultVolume}%\n` +
    `║ 🔄 Sync Mode:            ${effective.syncMode === "server" ? "Server-Side RTP" : "Client-Sync (Hybrid)"}\n` +
    `║ ⬇️  Full Download Mode:    ${effective.fullDownloadMode ? "ON (wait for complete download)" : "OFF (progressive start)"}\n` +
    `║ 🐛 Debug Mode:            ${effective.debugMode ? "ON ✓" : "OFF"}\n` +
    `${"═".repeat(70)}\n`
  );
};
