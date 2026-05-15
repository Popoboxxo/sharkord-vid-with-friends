/**
 * Plugin lifecycle — onLoad and onUnload.
 *
 * Referenced by: REQ-014, REQ-015, REQ-016, REQ-017, REQ-018
 */
import { QueueManager } from "./queue/queue-manager";
import { StreamManager } from "./stream/stream-manager";
import { SyncController } from "./sync/sync-controller";

import { registerPlayCommand } from "./commands/play";
import { registerQueueCommand } from "./commands/queue";
import { registerSkipCommand } from "./commands/skip";
import { registerRemoveCommand } from "./commands/remove";
import { registerStopCommand } from "./commands/stop";
import { registerNowPlayingCommand } from "./commands/nowplaying";
import { registerPauseCommand } from "./commands/pause";
import { registerResumeCommand } from "./commands/resume";
import { registerVolumeCommand } from "./commands/volume";
import { registerDebugCacheCommand } from "./commands/debug_cache";
import { registerBugReportCommand } from "./commands/bug-report";

import { DEFAULT_SETTINGS, PLUGIN_NAME } from "./utils/constants";
import type { PluginContext } from "./utils/settings";
import {
  setSettingsAccessor,
  setRuntimeSettingsOverrides,
  runtimeSettingsOverrides,
  logSettingsSnapshot,
  resolveEffectiveSettings,
  toSettingsSnapshot,
  diffSettingsSnapshot,
  extractRuntimeSettingOverrides,
} from "./utils/settings";
import {
  setQueueManager,
  setStreamManager,
  setSyncController,
  queueManager,
  streamManager,
  syncController,
} from "./utils/plugin-state";
import { handleVoiceRuntimeClosed } from "./handlers/voice-runtime";
import { startStream } from "./services/streaming";

import { components as pluginComponents } from "./ui/components";

let settingsWatcher: ReturnType<typeof setInterval> | null = null;

export const onLoad = async (ctx: PluginContext): Promise<void> => {
  ctx.log(`[${PLUGIN_NAME}] Loading...`);

  setSettingsAccessor(null);
  setRuntimeSettingsOverrides({});

  const qm = new QueueManager();
  const sm = new StreamManager();
  const sc = new SyncController(qm, async (channelId, item) => {
    await startStream(ctx, channelId, item, sm, sc);
  });

  setQueueManager(qm);
  setStreamManager(sm);
  setSyncController(sc);

  // Register settings
  const settingsResult = ctx.settings.register([
    {
      key: "videoBitrate",
      name: "Video-Bitrate (kbps)",
      type: "number",
      description: "Controls video quality for RTP streaming. [REQ-018-A]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_VIDEO,
      min: 1000,
      max: 12000,
    },
    {
      key: "audioBitrate",
      name: "Audio-Bitrate (kbps)",
      type: "number",
      description: "Controls audio quality for RTP streaming. [REQ-018-B]",
      defaultValue: DEFAULT_SETTINGS.BITRATE_AUDIO,
      min: 64,
      max: 320,
    },
    {
      key: "defaultVolume",
      name: "Standard-Lautstärke (%)",
      type: "number",
      description: "Default playback volume when a new video starts. [REQ-018-C]",
      defaultValue: DEFAULT_SETTINGS.DEFAULT_VOLUME,
      min: 0,
      max: 100,
    },
    {
      key: "syncMode",
      name: "Synchronisierungs-Modus",
      type: "select",
      description: "Server-Streaming vs Client-Sync. [REQ-018-D]",
      defaultValue: DEFAULT_SETTINGS.SYNC_MODE,
      options: [
        { label: "Server-Streaming (Standard)", value: "server" },
        { label: "Client-Sync (Hybrid/YouTube Player)", value: "client" },
      ],
    },
    {
      key: "fullDownloadMode",
      name: "Full-Download-Modus",
      type: "boolean",
      description: "Fully download before playback starts. [REQ-036]",
      defaultValue: false,
    },
    {
      key: "debugMode",
      name: "Debug-Ausgabe aktivieren",
      type: "boolean",
      description: "Enables detailed logging for debugging. [REQ-026]",
      defaultValue: false,
    },
    {
      key: "githubToken",
      name: "GitHub Token (for bug reports)",
      type: "string",
      description: "Personal Access Token for posting bug reports. [REQ-041]",
      defaultValue: "",
    },
  ]) as unknown;

  const maybePromise = settingsResult as { then?: (cb: (value: unknown) => unknown) => unknown };
  if (typeof maybePromise?.then === "function") {
    try {
      const resolved = await Promise.resolve(settingsResult);
      const accessor = resolved as { get?: <T = unknown>(key: string) => T | undefined };
      if (typeof accessor?.get === "function") {
        setSettingsAccessor({ get: accessor.get.bind(accessor) });
      }
    } catch { /* */ }
  } else {
    const accessor = settingsResult as { get?: <T = unknown>(key: string) => T | undefined };
    if (typeof accessor?.get === "function") {
      setSettingsAccessor({ get: accessor.get.bind(accessor) });
    }
  }

  // Register commands with compatibility wrapper
  type CommandArgDef = { name: string; description?: string; type: string; required?: boolean };
  type CommandInvoker = { userId: number; currentVoiceChannelId?: number };
  type CommandDefCompat<TArgs = void> = {
    name: string;
    description?: string;
    args?: CommandArgDef[];
    execute?: (invoker: CommandInvoker, args: TArgs) => Promise<unknown>;
    executes?: (invoker: CommandInvoker, args: TArgs) => Promise<unknown>;
  };

  const commandCompatCtx = {
    ...ctx,
    commands: {
      ...ctx.commands,
      register: <TArgs = void>(command: CommandDefCompat<TArgs>): void => {
        const rawHandler = typeof command.execute === "function" ? command.execute : command.executes;
        if (typeof rawHandler !== "function") {
          throw new Error(`Command '${command.name}' has no execute handler`);
        }
        const execute = async (invoker: CommandInvoker, args: TArgs): Promise<string> => {
          try {
            const result = await rawHandler(invoker, args);
            if (result && typeof result === "object") {
              const maybeResponse = (result as { response?: unknown }).response;
              if (typeof maybeResponse === "string") return maybeResponse;
            }
            if (typeof result === "string") return result;
            if (result === undefined || result === null) return "";
            return String(result);
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        };
        ctx.commands.register({
          name: command.name,
          description: command.description,
          args: command.args,
          execute,
        });
      },
    },
  };

  registerPlayCommand(commandCompatCtx as never, qm, sc);
  registerQueueCommand(commandCompatCtx as never, qm);
  registerSkipCommand(commandCompatCtx as never, sc, sm);
  registerRemoveCommand(commandCompatCtx as never, qm);
  registerStopCommand(commandCompatCtx as never, sc, sm);
  registerNowPlayingCommand(commandCompatCtx as never, qm);
  registerPauseCommand(commandCompatCtx as never, sc, sm);
  registerResumeCommand(commandCompatCtx as never, sc, sm);
  registerVolumeCommand(commandCompatCtx as never, sc);
  registerDebugCacheCommand(commandCompatCtx as never);
  registerBugReportCommand(commandCompatCtx as never);

  // Register UI components
  const uiApi = (ctx as { ui?: { registerComponents?: (components: unknown) => void } }).ui;
  if (typeof uiApi?.registerComponents === "function") {
    uiApi.registerComponents(pluginComponents);
  } else {
    ctx.debug(`[${PLUGIN_NAME}] Runtime has no ctx.ui.registerComponents(); using exported components fallback.`);
  }

  let previousSettingsSnapshot = logSettingsSnapshot(ctx, "plugin:loaded");

  ctx.events.on("settings:changed", (...args: unknown[]) => {
    const payload = args[0];
    const overrides = extractRuntimeSettingOverrides(payload);
    setRuntimeSettingsOverrides({ ...runtimeSettingsOverrides, ...overrides });
    previousSettingsSnapshot = logSettingsSnapshot(ctx, "settings:changed", args, previousSettingsSnapshot);
  });

  if (settingsWatcher) { clearInterval(settingsWatcher); settingsWatcher = null; }
  settingsWatcher = setInterval(() => {
    const currentSnapshot = toSettingsSnapshot(resolveEffectiveSettings(ctx));
    const changes = diffSettingsSnapshot(previousSettingsSnapshot, currentSnapshot);
    if (changes.length > 0) {
      previousSettingsSnapshot = logSettingsSnapshot(ctx, "settings:detected", { source: "poll" }, previousSettingsSnapshot);
    }
  }, 2000);

  ctx.events.on("voice:runtime_closed", handleVoiceRuntimeClosed(ctx));

  ctx.log(`[${PLUGIN_NAME}] Loaded successfully.`);
};

export const onUnload = (ctx: PluginContext): void => {
  ctx.log(`[${PLUGIN_NAME}] Unloading...`);

  setSettingsAccessor(null);
  setRuntimeSettingsOverrides({});

  if (settingsWatcher) { clearInterval(settingsWatcher); settingsWatcher = null; }

  streamManager.cleanupAll();
  syncController.cleanupAll();

  ctx.log(`[${PLUGIN_NAME}] Unloaded.`);
};

// Re-export components for SDK wiring
export { components } from "./ui/components";
