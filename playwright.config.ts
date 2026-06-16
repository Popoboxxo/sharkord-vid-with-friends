import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * E2E config — drives the *built* plugin client bundle in a real Chromium,
 * with the Sharkord host (React + store) stubbed by tests/e2e/harness.html.
 *
 * Browser: reuses a locally-cached Playwright Chromium if present (avoids a
 * download in CI-less/offline dev). Override with PW_CHROMIUM if needed.
 */

function findChromium(): string | undefined {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) return process.env.PW_CHROMIUM;
  const base = join(homedir(), "AppData", "Local", "ms-playwright");
  for (const rev of ["1223", "1228", "1230", "1220"]) {
    const exe = join(base, `chromium-${rev}`, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const chromium = findChromium();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5599",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
  ],
  webServer: {
    // Dependency-free Bun static server (serves repo root).
    command: "bun run tests/e2e/serve.ts",
    env: { PORT: "5599" },
    url: "http://127.0.0.1:5599/tests/e2e/harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
