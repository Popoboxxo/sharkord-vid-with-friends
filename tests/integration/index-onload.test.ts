/**
 * Integration tests for plugin entrypoint onLoad/onUnload.
 *
 * Referenced by: REQ-015, REQ-017
 */
import { describe, it, expect } from "bun:test";
import { onLoad, onUnload } from "../../src/index";
import { createMockPluginContext } from "./mock-plugin-context";

describe("Plugin entrypoint lifecycle", () => {
  it("[REQ-015] should load and register commands", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    expect(ctx.commands.registered.has("watch")).toBe(true);
    expect(ctx.commands.registered.has("queue")).toBe(true);
    expect(ctx.commands.registered.has("skip")).toBe(true);
    expect(ctx.commands.registered.has("remove")).toBe(true);
    expect(ctx.commands.registered.has("watch_stop")).toBe(true);
    expect(ctx.commands.registered.has("nowplaying")).toBe(true);
    expect(ctx.commands.registered.has("pause")).toBe(true);
    expect(ctx.commands.registered.has("resume")).toBe(true);
    expect(ctx.commands.registered.has("volume")).toBe(true);
    expect(ctx.commands.registered.has("debug_cache")).toBe(true);

    onUnload(ctx as never);
  });

  it("[REQ-017] should register UI components during onLoad", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    expect(ctx.ui.registeredComponents.length).toBeGreaterThan(0);

    const components = ctx.ui.registeredComponents[0] as Record<string, unknown[]>;
    expect(Array.isArray(components.TOPBAR_RIGHT)).toBe(true);
    expect(Array.isArray(components.HOME_SCREEN)).toBe(true);
    expect(Array.isArray(components.ADMIN_SETTINGS)).toBe(true);

    onUnload(ctx as never);
  });

  it("[REQ-018-A] [REQ-018-B] [REQ-018-C] should register bitrate/volume settings with expected defaults and ranges", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    const defs = ctx.settings.registeredDefinitions;
    const video = defs.find((d) => d.key === "videoBitrate");
    const audio = defs.find((d) => d.key === "audioBitrate");
    const volume = defs.find((d) => d.key === "defaultVolume");
    const fullDownloadMode = defs.find((d) => d.key === "fullDownloadMode");

    expect(video?.type).toBe("number");
    expect(video?.defaultValue).toBe(3000);
    expect(video?.min).toBe(1000);
    expect(video?.max).toBe(12000);

    expect(audio?.type).toBe("number");
    expect(audio?.defaultValue).toBe(128);
    expect(audio?.min).toBe(64);
    expect(audio?.max).toBe(320);

    expect(volume?.type).toBe("number");
    expect(volume?.defaultValue).toBe(75);
    expect(volume?.min).toBe(0);
    expect(volume?.max).toBe(100);

    expect(fullDownloadMode?.type).toBe("boolean");
    expect(fullDownloadMode?.defaultValue).toBe(false);

    onUnload(ctx as never);
  });

  it("[REQ-039] should log all plugin settings at startup", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    // Find structured startup settings log entry
    const settingsLog = ctx.logs.find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings]") && a.includes("plugin:loaded"))
    );

    expect(settingsLog).toBeDefined();

    // The second arg should be a JSON string with structured payload
    const jsonStr = settingsLog!.args[1] as string;
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty("trigger", "plugin:loaded");
    expect(parsed).toHaveProperty("settings");
    expect(parsed.settings).toHaveProperty("videoBitrate");
    expect(parsed.settings).toHaveProperty("audioBitrate");
    expect(parsed.settings).toHaveProperty("defaultVolume");
    expect(parsed.settings).toHaveProperty("syncMode");
    expect(parsed.settings).toHaveProperty("fullDownloadMode");
    expect(parsed.settings).toHaveProperty("debugMode");

    // Readable companion log should also be present
    const readableLog = ctx.logs.find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings:Readable]"))
    );
    expect(readableLog).toBeDefined();

    onUnload(ctx as never);
  });

  it("[REQ-039] should register settings:changed event listener", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    // Verify the settings:changed listener was registered
    const handlers = ctx.events.handlers.get("settings:changed");
    expect(handlers).toBeDefined();
    expect(handlers!.size).toBeGreaterThan(0);

    // Simulate a settings change event
    const logCountBefore = ctx.logs.length;
    ctx.settings.set("fullDownloadMode", true);
    ctx.events.emit("settings:changed", { key: "debugMode", value: true });
    const logCountAfter = ctx.logs.length;

    // Should have logged at least structured + readable settings logs
    expect(logCountAfter).toBeGreaterThan(logCountBefore);

    const changeLogs = ctx.logs.slice(logCountBefore).filter(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings]"))
    );
    expect(changeLogs.length).toBeGreaterThanOrEqual(1);

    const structuredChangeLog = ctx.logs.slice(logCountBefore).find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings]") && a.includes("settings:changed"))
    );
    expect(structuredChangeLog).toBeDefined();
    const structuredPayload = JSON.parse(String(structuredChangeLog!.args[1]));
    expect(structuredPayload).toHaveProperty("settings");
    expect(structuredPayload.settings).toHaveProperty("videoBitrate");
    expect(structuredPayload.settings).toHaveProperty("audioBitrate");
    expect(structuredPayload.settings).toHaveProperty("defaultVolume");
    expect(structuredPayload.settings).toHaveProperty("syncMode");
    expect(structuredPayload.settings).toHaveProperty("fullDownloadMode", true);
    expect(structuredPayload.settings).toHaveProperty("debugMode");
    expect(Array.isArray(structuredPayload.changed)).toBe(true);

    const changedReadable = ctx.logs.slice(logCountBefore).find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings:Changed]"))
    );
    expect(changedReadable).toBeDefined();
    expect(String(changedReadable!.args[1])).toContain("fullDownloadMode:");
    expect(String(changedReadable!.args[1])).toContain("false -> true");

    const readableChangeLogs = ctx.logs.slice(logCountBefore).filter(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings:Readable]"))
    );
    expect(readableChangeLogs.length).toBeGreaterThanOrEqual(1);

    onUnload(ctx as never);
  });

  it("[REQ-039] should apply fullDownloadMode from settings:changed payload even when store read is stale", async () => {
    const ctx = createMockPluginContext();

    await onLoad(ctx as never);

    // Simulate runtime where setting backend remains stale (still false)
    // but event payload carries the new value.
    ctx.events.emit("settings:changed", { key: "fullDownloadMode", value: true });

    const structuredChangeLog = ctx.logs.find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings]") && a.includes("settings:changed"))
    );

    expect(structuredChangeLog).toBeDefined();
    const structuredPayload = JSON.parse(String(structuredChangeLog!.args[1]));
    expect(structuredPayload.settings).toHaveProperty("fullDownloadMode", true);

    const changedReadable = ctx.logs.find(
      (l) => l.level === "log" && l.args.some((a) => typeof a === "string" && a.includes("[Settings:Changed]"))
    );
    expect(changedReadable).toBeDefined();
    expect(String(changedReadable!.args[1])).toContain("fullDownloadMode: false -> true");

    onUnload(ctx as never);
  });
});
