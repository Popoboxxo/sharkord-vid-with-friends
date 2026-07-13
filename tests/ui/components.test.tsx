/**
 * Slot components — NowPlayingBadge, QueueCard, WatchButton, QueueManager.
 *
 * Renders the real components from src/client/index.tsx against a mock host
 * store, asserting they reflect vid:state and drive vid:control / sendMessage.
 */

import { afterEach, beforeEach, describe, expect, mock as bunMock, test } from "bun:test";
import { render, screen, act } from "@testing-library/react";
import { components } from "../../src/client/index";
import { installMockStore, type MockStore } from "./mock-store";

const [NowPlayingBadge] = components.topbar_right;
const [QueueCard] = components.home_screen;
const [WatchButton] = components.chat_actions;
const [QueueManager] = components.full_screen;

const PLAYING = {
  nowPlaying: { title: "Never Gonna Give You Up", duration: 213 },
  isPaused: false,
  volume: 100,
  queueCount: 3,
  upcoming: ["Song B", "Song C"],
};

let mock: MockStore;
beforeEach(() => {
  mock = installMockStore({ selectedChannelId: 5 });
});
afterEach(() => mock.uninstall());

/** Flush the mount-time vid:state poll + React re-render. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NowPlayingBadge (topbar_right)", () => {
  test("shows Idle when nothing is playing", async () => {
    mock.onAction("vid:state", () => ({ ...PLAYING, nowPlaying: null }));
    render(<NowPlayingBadge />);
    await flush();
    expect(screen.getByText("Idle")).toBeDefined();
  });

  test("shows the track title and pause/skip controls when playing", async () => {
    mock.onAction("vid:state", () => PLAYING);
    render(<NowPlayingBadge />);
    await flush();
    expect(screen.getByText("Never Gonna Give You Up")).toBeDefined();
    expect(screen.getByTitle("Pause")).toBeDefined();
    expect(screen.getByTitle("Skip")).toBeDefined();
  });

  test("pause button dispatches vid:control { op: pause }", async () => {
    mock.onAction("vid:state", () => PLAYING);
    mock.onAction("vid:control", () => undefined);
    render(<NowPlayingBadge />);
    await flush();
    await act(async () => screen.getByTitle("Pause").click());
    const control = mock.actionCalls.find((c) => c.name === "vid:control");
    expect(control?.payload).toEqual({ op: "pause" });
  });
});

describe("QueueCard (home_screen)", () => {
  test("prompts to use /vid-watch when idle", async () => {
    mock.onAction("vid:state", () => ({ ...PLAYING, nowPlaying: null }));
    render(<QueueCard />);
    await flush();
    expect(screen.getByText("/vid-watch")).toBeDefined();
  });

  test("shows now-playing title and remaining-in-queue count", async () => {
    mock.onAction("vid:state", () => PLAYING);
    render(<QueueCard />);
    await flush();
    expect(screen.getByText("Never Gonna Give You Up")).toBeDefined();
    expect(screen.getByText("2 more in queue")).toBeDefined();
  });
});

describe("WatchButton (chat_actions)", () => {
  test("sends /vid-watch <url> to the selected channel via the prompted URL", async () => {
    const origPrompt = window.prompt;
    window.prompt = bunMock(() => "https://youtu.be/abc");
    try {
      render(<WatchButton />);
      await act(async () => screen.getByTitle(/Watch a YouTube video/).click());
      expect(mock.sentMessages).toEqual([{ channelId: 5, content: "/vid-watch https://youtu.be/abc" }]);
    } finally {
      window.prompt = origPrompt;
    }
  });

  test("sends nothing when the prompt is cancelled", async () => {
    const origPrompt = window.prompt;
    window.prompt = bunMock(() => null);
    try {
      render(<WatchButton />);
      await act(async () => screen.getByTitle(/Watch a YouTube video/).click());
      expect(mock.sentMessages).toEqual([]);
    } finally {
      window.prompt = origPrompt;
    }
  });
});

describe("QueueManager (full_screen)", () => {
  test("lists upcoming tracks and renders Stop control when playing", async () => {
    mock.onAction("vid:state", () => PLAYING);
    render(<QueueManager />);
    await flush();
    expect(screen.getByText("Song B")).toBeDefined();
    expect(screen.getByText("Song C")).toBeDefined();
    expect(screen.getByText("Stop")).toBeDefined();
  });

  test("stop button dispatches vid:control { op: stop }", async () => {
    mock.onAction("vid:state", () => PLAYING);
    mock.onAction("vid:control", () => undefined);
    render(<QueueManager />);
    await flush();
    await act(async () => screen.getByText("Stop").click());
    const control = mock.actionCalls.find((c) => c.name === "vid:control");
    expect(control?.payload).toEqual({ op: "stop" });
  });

  test("shows empty-queue message when idle", async () => {
    mock.onAction("vid:state", () => ({ ...PLAYING, nowPlaying: null, queueCount: 0, upcoming: [] }));
    render(<QueueManager />);
    await flush();
    expect(screen.getByText("Queue is empty.")).toBeDefined();
  });
});
