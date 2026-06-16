/**
 * Mock Sharkord host store for UI tests.
 *
 * Plugin client components read live state from `window.__SHARKORD_STORE__` and
 * trigger work via `executePluginAction(name, payload)`. This factory installs a
 * controllable fake store on `window` so slot components + UI-Kit hooks can be
 * rendered and asserted without the real host.
 *
 * Canonical source target: sharkord-meta/templates/plugin-ui/testing/.
 */

import type { SharkordState, SharkordStore } from "../../src/ui/kit/store";

export type ActionHandler = (payload?: unknown) => unknown | Promise<unknown>;

export interface MockStore {
  store: SharkordStore;
  /** Latest state object (mutate via setState). */
  state: SharkordState;
  /** Replace state + notify subscribers. */
  setState: (patch: Partial<SharkordState>) => void;
  /** Register a handler for executePluginAction(name). */
  onAction: (name: string, handler: ActionHandler) => void;
  /** Recorded executePluginAction calls. */
  actionCalls: Array<{ name: string; payload?: unknown }>;
  /** Recorded sendMessage calls. */
  sentMessages: Array<{ channelId: number; content: string }>;
  /** Recorded selectChannel calls. */
  selectedChannels: number[];
  /** Remove the store from window. */
  uninstall: () => void;
}

const DEFAULT_STATE: SharkordState = {
  users: [],
  channels: [],
  ownUserId: undefined,
  selectedChannelId: undefined,
  currentVoiceChannelId: undefined,
};

/** Create + install a mock store on `window.__SHARKORD_STORE__`. */
export function installMockStore(initial: Partial<SharkordState> = {}): MockStore {
  const state: SharkordState = { ...DEFAULT_STATE, ...initial };
  const listeners = new Set<() => void>();
  const handlers = new Map<string, ActionHandler>();
  const actionCalls: MockStore["actionCalls"] = [];
  const sentMessages: MockStore["sentMessages"] = [];
  const selectedChannels: number[] = [];

  const notify = () => {
    for (const l of listeners) l();
  };

  const store: SharkordStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions: {
      sendMessage: async (channelId, content) => {
        sentMessages.push({ channelId, content });
      },
      selectChannel: (channelId) => {
        selectedChannels.push(channelId);
      },
      executePluginAction: async <TRes = unknown>(name: string, payload?: unknown) => {
        actionCalls.push({ name, payload });
        const handler = handlers.get(name);
        return (handler ? await handler(payload) : undefined) as TRes;
      },
    },
  };

  (window as unknown as { __SHARKORD_STORE__?: SharkordStore }).__SHARKORD_STORE__ = store;

  return {
    store,
    state,
    setState: (patch) => {
      Object.assign(state, patch);
      notify();
    },
    onAction: (name, handler) => handlers.set(name, handler),
    actionCalls,
    sentMessages,
    selectedChannels,
    uninstall: () => {
      delete (window as unknown as { __SHARKORD_STORE__?: SharkordStore }).__SHARKORD_STORE__;
    },
  };
}
