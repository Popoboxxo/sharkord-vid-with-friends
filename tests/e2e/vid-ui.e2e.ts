/**
 * End-to-end UI tests against the BUILT plugin client bundle.
 *
 * Unlike the bun/happy-dom suites (which run the source), these load
 * dist/<id>/client/index.js in a real Chromium with React + the host store
 * stubbed exactly as production does. This catches build/shim regressions the
 * unit layer can't see (e.g. the react-alias plugin breaking).
 */

import { expect, test } from "@playwright/test";

const PLAYING = {
  nowPlaying: { title: "Never Gonna Give You Up", duration: 213 },
  isPaused: false,
  volume: 100,
  queueCount: 3,
  upcoming: ["Song B", "Song C"],
};

const PLUGIN = "sharkord-vid-with-friends";

function harnessURL(slot: string, state: Record<string, unknown>): string {
  const q = new URLSearchParams({ plugin: PLUGIN, slot, state: JSON.stringify(state) });
  return `/tests/e2e/harness.html?${q.toString()}`;
}

/** Wraps a vid:state result into the harness `actions` map. */
function withState(vid: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { actions: { "vid:state": vid }, ...extra };
}

test("built bundle loads with the host React shim (no missing-React error)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(harnessURL("home_screen", withState({ ...PLAYING, nowPlaying: null })));
  await page.waitForFunction(() => (window as { __E2E_READY__?: boolean }).__E2E_READY__ === true);
  expect(errors.join("\n")).not.toContain("__SHARKORD_REACT__ missing");
});

test("home_screen QueueCard renders idle prompt from vid:state", async ({ page }) => {
  await page.goto(harnessURL("home_screen", withState({ ...PLAYING, nowPlaying: null })));
  await expect(page.getByText("/vid-watch")).toBeVisible();
});

test("home_screen QueueCard renders now-playing title", async ({ page }) => {
  await page.goto(harnessURL("home_screen", withState(PLAYING)));
  await expect(page.getByText("Never Gonna Give You Up")).toBeVisible();
  await expect(page.getByText("2 more in queue")).toBeVisible();
});

test("full_screen QueueManager lists upcoming and dispatches stop", async ({ page }) => {
  await page.goto(harnessURL("full_screen", withState(PLAYING)));
  await expect(page.getByText("Song B")).toBeVisible();
  await expect(page.getByText("Song C")).toBeVisible();

  await page.getByText("Stop", { exact: true }).click();
  const calls = await page.evaluate(() => (window as { __E2E__?: { actionCalls: unknown[] } }).__E2E__!.actionCalls);
  expect(calls).toContainEqual({ name: "vid:control", payload: { op: "stop" } });
});

test("topbar_right NowPlayingBadge toggles pause via vid:control", async ({ page }) => {
  await page.goto(harnessURL("topbar_right", withState(PLAYING)));
  await page.getByTitle("Pause").click();
  const calls = await page.evaluate(() => (window as { __E2E__?: { actionCalls: unknown[] } }).__E2E__!.actionCalls);
  expect(calls).toContainEqual({ name: "vid:control", payload: { op: "pause" } });
});

test("chat_actions WatchButton sends /vid-watch with the prompted URL", async ({ page }) => {
  await page.goto(harnessURL("chat_actions", { selectedChannelId: 5, promptAnswer: "https://youtu.be/abc" }));
  await page.getByTitle(/Watch a YouTube video/).click();
  const sent = await page.evaluate(() => (window as { __E2E__?: { sentMessages: unknown[] } }).__E2E__!.sentMessages);
  expect(sent).toContainEqual({ channelId: 5, content: "/vid-watch https://youtu.be/abc" });
});
