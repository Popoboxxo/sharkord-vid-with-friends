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
});
