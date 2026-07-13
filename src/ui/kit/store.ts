/**
 * Sharkord Plugin UI-Kit — host store access.
 *
 * Plugin client components receive NO props; they read live state from the host
 * store exposed on `window.__SHARKORD_STORE__` and trigger privileged work via
 * server actions (`executePluginAction`). This module wraps that global with a
 * typed accessor + a React hook that re-renders on store changes.
 *
 * Canonical source: sharkord-meta/templates/plugin-ui/.
 */

import { useEffect, useState } from "react";

/** Minimal shape of the host store (see @sharkord/shared TPluginStore). */
export type SharkordState = {
  users: Array<{ id?: number; userId?: number; username?: string; [k: string]: unknown }>;
  channels: unknown[];
  ownUserId: number | undefined;
  selectedChannelId: number | undefined;
  currentVoiceChannelId: number | undefined;
  [k: string]: unknown;
};

export type SharkordStore = {
  getState: () => SharkordState;
  subscribe: (listener: () => void) => () => void;
  actions: {
    sendMessage: (channelId: number, content: string) => Promise<void>;
    selectChannel: (channelId: number) => void;
    executePluginAction: <TRes = unknown, TPayload = unknown>(
      actionName: string,
      payload?: TPayload,
    ) => Promise<TRes>;
  };
};

declare global {
  interface Window {
    __SHARKORD_STORE__?: SharkordStore;
  }
}

/** Raw host store (may be undefined if accessed too early / outside host). */
export function getStore(): SharkordStore | undefined {
  return typeof window !== "undefined" ? window.__SHARKORD_STORE__ : undefined;
}

/** Call a server-side plugin action registered via ctx.actions.register. */
export async function callAction<TRes = unknown, TPayload = unknown>(
  actionName: string,
  payload?: TPayload,
): Promise<TRes | undefined> {
  const store = getStore();
  if (!store) return undefined;
  return store.actions.executePluginAction<TRes, TPayload>(actionName, payload);
}

/** Subscribe to host state with a selector; re-renders on change. */
export function useSharkordState<T>(selector: (s: SharkordState) => T, fallback: T): T {
  const store = getStore();
  const [value, setValue] = useState<T>(() => (store ? selector(store.getState()) : fallback));

  useEffect(() => {
    if (!store) return;
    const update = () => setValue(selector(store.getState()));
    update();
    return store.subscribe(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}
