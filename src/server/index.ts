/**
 * Native Sharkord v0.0.22 server entry — sharkord-vid-with-friends.
 *
 * Exports named onLoad/onUnload (the v0.0.22 contract), enables the UI feature
 * and registers server-side actions that the client UI calls via
 * window.__SHARKORD_STORE__.actions.executePluginAction(...).
 *
 * The heavy lifting (queue, streaming, commands, settings) lives in
 * ../plugin-lifecycle; this module only adapts it to the v0.0.22 entry shape.
 */

import { onLoad as baseOnLoad, onUnload as baseOnUnload } from "../plugin-lifecycle";
import type { PluginContext as LifecycleContext } from "../utils/settings";
import { queueManager, syncController } from "../utils/plugin-state";

/** Caller context provided by the host for actions/commands. */
type Invoker = { userId: number; currentVoiceChannelId?: number };

/** Minimal v0.0.22 context surface this entry uses (kept loose for SDK drift). */
type ServerCtx = {
  ui?: { enable?: () => void };
  actions?: { register?: (action: { name: string; description?: string; execute: (ctx: Invoker, payload: unknown) => Promise<unknown> }) => void };
  log?: (...a: unknown[]) => void;
};

/** Snapshot consumed by the client UI (topbar badge + queue card/panel). */
function snapshot(channelId: number) {
  const state = queueManager.getState(channelId);
  return {
    channelId,
    nowPlaying: state.current ? { title: state.current.title, duration: state.current.duration } : null,
    isPaused: syncController.isPaused(channelId),
    volume: syncController.getVolume(channelId),
    queueCount: state.size,
    upcoming: state.upcoming.slice(0, 8).map((i) => i.title),
  };
}

export async function onLoad(ctx: unknown): Promise<void> {
  await baseOnLoad(ctx as LifecycleContext);

  const c = ctx as ServerCtx;
  // v0.0.22: enable client UI slots.
  c.ui?.enable?.();

  // Read-only live state for the UI.
  c.actions?.register?.({
    name: "vid:state",
    description: "Return the now-playing snapshot for the caller's voice channel.",
    async execute(invoker) {
      const ch = invoker.currentVoiceChannelId;
      if (!ch) return { channelId: 0, nowPlaying: null, isPaused: false, volume: 100, queueCount: 0, upcoming: [] };
      return snapshot(ch);
    },
  });

  // Playback controls invoked from the topbar / full-screen UI.
  c.actions?.register?.({
    name: "vid:control",
    description: "Control playback: pause | resume | skip | stop.",
    async execute(invoker, payload) {
      const ch = invoker.currentVoiceChannelId;
      if (!ch) return { error: "not_in_voice" };
      const op = (payload as { op?: string } | undefined)?.op;
      switch (op) {
        case "pause": syncController.setPaused(ch, true); break;
        case "resume": syncController.setPaused(ch, false); break;
        case "skip": await syncController.skip(ch); break;
        case "stop": syncController.stop(ch); break;
        default: return { error: "unknown_op", op };
      }
      return snapshot(ch);
    },
  });
}

export const onUnload = baseOnUnload;
