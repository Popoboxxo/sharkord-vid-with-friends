/**
 * Plugin settings resolution, validation and logging.
 */

import { DEFAULT_SETTINGS, PLUGIN_NAME } from "./constants";

// ---- Types ----

export type PluginContext = {
  log: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  commands: {
    register: <TArgs = void>(command: {
      name: string;
      description?: string;
      args?: { name: string; description?: string; type: string; required?: boolean }[];
      execute: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
      executes?: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
  events: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  settings: {
    register: (definitions: unknown) => void;
    get: <T = unknown>(key: string) => T | undefined;
  };
  ui?: {
    registerComponents?: (components: unknown) => void;
  };
};

export type SyncMode = "server" | "client";

export type EffectivePluginSettings = {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  defaultVolume: number;
  syncMode: SyncMode;
  fullDownloadMode: boolean;
  debugMode: boolean;
};

export type EffectiveSettingsSnapshot = {
  videoBitrate: number;
  audioBitrate: number;
  defaultVolume: number;
  syncMode: SyncMode;
  fullDownloadMode: boolean;
  debugMode: boolean;
};

// ---- State ----

export let settingsAccessor: { get: <T = unknown>(key: string) => T | undefined } | null = null;
export let runtimeSettingsOverrides: Partial<EffectiveSettingsSnapshot> = {};

export function setSettingsAccessor(accessor: typeof settingsAccessor): void {
  settingsAccessor = accessor;
}

export function setRuntimeSettingsOverrides(overrides: Partial<EffectiveSettingsSnapshot>): void {
  runtimeSettingsOverrides = overrides;
}

// ---- Helpers ----

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const parseBooleanSetting = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
};

export const getSettingValue = <T = unknown>(ctx: PluginContext, key: string): T | undefined => {
  try {
    if (settingsAccessor?.get) {
      const value = settingsAccessor.get<T>(key);
      if (value !== undefined) return value;
    }
  } catch {
    // ignore accessor read failure and fallback to ctx.settings.get
  }

  return ctx.settings?.get?.<T>(key);
};

export const extractRuntimeSettingOverrides = (eventPayload: unknown): Partial<EffectiveSettingsSnapshot> => {
  if (!eventPayload || typeof eventPayload !== "object") return {};

  const payload = eventPayload as Record<string, unknown>;
  const override: Partial<EffectiveSettingsSnapshot> = {};

  const applyKeyValue = (key: string, value: unknown): void => {
    if (key === "videoBitrate") {
      const n = Number(value);
      if (Number.isFinite(n)) override.videoBitrate = clampNumber(n, 1000, 12000);
    }
    if (key === "audioBitrate") {
      const n = Number(value);
      if (Number.isFinite(n)) override.audioBitrate = clampNumber(n, 64, 320);
    }
    if (key === "defaultVolume") {
      const n = Number(value);
      if (Number.isFinite(n)) override.defaultVolume = clampNumber(n, 0, 100);
    }
    if (key === "syncMode") {
      override.syncMode = value === "client" ? "client" : "server";
    }
    if (key === "fullDownloadMode") {
      override.fullDownloadMode = parseBooleanSetting(value, false);
    }
    if (key === "debugMode") {
      override.debugMode = parseBooleanSetting(value, false);
    }
  };

  if (typeof payload.key === "string" && "value" in payload) {
    applyKeyValue(payload.key, payload.value);
  }

  if (payload.settings && typeof payload.settings === "object") {
    const settingsObj = payload.settings as Record<string, unknown>;
    for (const [key, value] of Object.entries(settingsObj)) {
      applyKeyValue(key, value);
    }
  }

  return override;
};

export const resolveEffectiveSettings = (ctx: PluginContext): EffectivePluginSettings => {
  const rawVideoBitrate = Number(getSettingValue(ctx, "videoBitrate"));
  const rawAudioBitrate = Number(getSettingValue(ctx, "audioBitrate"));
  const rawDefaultVolume = Number(getSettingValue(ctx, "defaultVolume"));
  const rawSyncMode = getSettingValue(ctx, "syncMode");
  const rawFullDownloadMode = getSettingValue(ctx, "fullDownloadMode");
  const rawDebugMode = getSettingValue(ctx, "debugMode");

  const resolvedVideoBitrate = runtimeSettingsOverrides.videoBitrate ?? rawVideoBitrate;
  const resolvedAudioBitrate = runtimeSettingsOverrides.audioBitrate ?? rawAudioBitrate;
  const resolvedDefaultVolume = runtimeSettingsOverrides.defaultVolume ?? rawDefaultVolume;
  const resolvedSyncMode = runtimeSettingsOverrides.syncMode ?? rawSyncMode;
  const resolvedFullDownloadMode = runtimeSettingsOverrides.fullDownloadMode ?? rawFullDownloadMode;
  const resolvedDebugMode = runtimeSettingsOverrides.debugMode ?? rawDebugMode;

  const videoBitrateKbps = Number.isFinite(resolvedVideoBitrate)
    ? clampNumber(Number(resolvedVideoBitrate), 1000, 12000)
    : DEFAULT_SETTINGS.BITRATE_VIDEO;
  const audioBitrateKbps = Number.isFinite(resolvedAudioBitrate)
    ? clampNumber(Number(resolvedAudioBitrate), 64, 320)
    : DEFAULT_SETTINGS.BITRATE_AUDIO;
  const defaultVolume = Number.isFinite(resolvedDefaultVolume)
    ? clampNumber(Number(resolvedDefaultVolume), 0, 100)
    : DEFAULT_SETTINGS.DEFAULT_VOLUME;

  const syncMode: SyncMode = resolvedSyncMode === "client" ? "client" : "server";
  const fullDownloadMode = parseBooleanSetting(resolvedFullDownloadMode, false);
  const debugMode = parseBooleanSetting(resolvedDebugMode, false);

  return {
    videoBitrateKbps,
    audioBitrateKbps,
    defaultVolume,
    syncMode,
    fullDownloadMode,
    debugMode,
  };
};

export const toSettingsSnapshot = (effective: EffectivePluginSettings): EffectiveSettingsSnapshot => ({
  videoBitrate: effective.videoBitrateKbps,
  audioBitrate: effective.audioBitrateKbps,
  defaultVolume: effective.defaultVolume,
  syncMode: effective.syncMode,
  fullDownloadMode: effective.fullDownloadMode,
  debugMode: effective.debugMode,
});

export const diffSettingsSnapshot = (
  previous: EffectiveSettingsSnapshot,
  current: EffectiveSettingsSnapshot
): Array<{ key: keyof EffectiveSettingsSnapshot; from: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot]; to: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot] }> => {
  const keys: Array<keyof EffectiveSettingsSnapshot> = [
    "videoBitrate",
    "audioBitrate",
    "defaultVolume",
    "syncMode",
    "fullDownloadMode",
    "debugMode",
  ];

  const changes: Array<{ key: keyof EffectiveSettingsSnapshot; from: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot]; to: EffectiveSettingsSnapshot[keyof EffectiveSettingsSnapshot] }> = [];
  for (const key of keys) {
    if (previous[key] !== current[key]) {
      changes.push({ key, from: previous[key], to: current[key] });
    }
  }
  return changes;
};

export const logSettingsSnapshot = (
  ctx: PluginContext,
  trigger: string,
  eventPayload?: unknown,
  previousSnapshot?: EffectiveSettingsSnapshot
): EffectiveSettingsSnapshot => {
  const effective = resolveEffectiveSettings(ctx);
  const currentSnapshot = toSettingsSnapshot(effective);
  const changes = previousSnapshot ? diffSettingsSnapshot(previousSnapshot, currentSnapshot) : [];
  const structured = {
    trigger,
    timestamp: new Date().toISOString(),
    eventPayload,
    changedCount: changes.length,
    changed: changes,
    settings: currentSnapshot,
  };

  ctx.log(`[${PLUGIN_NAME}] [Settings] (${trigger})`, JSON.stringify(structured));
  ctx.log(
    `[${PLUGIN_NAME}] [Settings:Readable]`,
    `video=${effective.videoBitrateKbps}kbps | audio=${effective.audioBitrateKbps}kbps | volume=${effective.defaultVolume}% | syncMode=${effective.syncMode} | fullDownloadMode=${effective.fullDownloadMode} | debugMode=${effective.debugMode}`
  );

  if (changes.length > 0) {
    const diffReadable = changes.map((entry) => `${entry.key}: ${String(entry.from)} -> ${String(entry.to)}`).join(" | ");
    ctx.log(`[${PLUGIN_NAME}] [Settings:Changed]`, diffReadable);
  }

  return currentSnapshot;
};
