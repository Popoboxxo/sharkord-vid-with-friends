/**
 * UI-Kit store layer — getStore, callAction, useSharkordState.
 *
 * These are the host-bridge primitives every plugin client depends on. Tested
 * against the mock store installed on window.__SHARKORD_STORE__.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { render, screen, act } from "@testing-library/react";
import { callAction, getStore, useSharkordState } from "../../src/ui/kit/store";
import { installMockStore, type MockStore } from "./mock-store";

let mock: MockStore | undefined;
afterEach(() => mock?.uninstall());

describe("getStore", () => {
  test("returns undefined when no host store is present", () => {
    delete (window as { __SHARKORD_STORE__?: unknown }).__SHARKORD_STORE__;
    expect(getStore()).toBeUndefined();
  });

  test("returns the installed host store", () => {
    mock = installMockStore();
    expect(getStore()).toBe(mock.store);
  });
});

describe("callAction", () => {
  test("resolves undefined when no store is present", async () => {
    delete (window as { __SHARKORD_STORE__?: unknown }).__SHARKORD_STORE__;
    expect(await callAction("vid:state")).toBeUndefined();
  });

  test("forwards name + payload to executePluginAction and returns its result", async () => {
    mock = installMockStore();
    mock.onAction("vid:state", () => ({ volume: 42 }));
    const res = await callAction<{ volume: number }>("vid:state");
    expect(res).toEqual({ volume: 42 });
    expect(mock.actionCalls).toEqual([{ name: "vid:state", payload: undefined }]);
  });

  test("passes payload through", async () => {
    mock = installMockStore();
    mock.onAction("vid:control", () => "ok");
    await callAction("vid:control", { op: "pause" });
    expect(mock.actionCalls[0]).toEqual({ name: "vid:control", payload: { op: "pause" } });
  });
});

describe("useSharkordState", () => {
  function Probe({ sel }: { sel: (s: { selectedChannelId?: number }) => unknown }) {
    const value = useSharkordState(sel, "FALLBACK");
    return <span data-testid="v">{String(value)}</span>;
  }

  test("uses fallback when no store is present", () => {
    delete (window as { __SHARKORD_STORE__?: unknown }).__SHARKORD_STORE__;
    render(<Probe sel={(s) => s.selectedChannelId} />);
    expect(screen.getByTestId("v").textContent).toBe("FALLBACK");
  });

  test("reads initial state from the store", () => {
    mock = installMockStore({ selectedChannelId: 7 });
    render(<Probe sel={(s) => s.selectedChannelId} />);
    expect(screen.getByTestId("v").textContent).toBe("7");
  });

  test("re-renders when the store notifies a change", () => {
    mock = installMockStore({ selectedChannelId: 1 });
    render(<Probe sel={(s) => s.selectedChannelId} />);
    expect(screen.getByTestId("v").textContent).toBe("1");
    act(() => mock!.setState({ selectedChannelId: 99 }));
    expect(screen.getByTestId("v").textContent).toBe("99");
  });
});
