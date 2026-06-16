/**
 * Playwright global setup — produces the artifacts the harness page needs:
 *   1. the plugin client bundle (dist/<id>/client/index.js) via `bun run build`
 *   2. the browser host shim (tests/e2e/.generated/host-shim.js)
 *
 * Runs in Playwright's Node runtime, so all Bun-specific work is delegated to
 * `bun` subprocesses. Both artifacts are served statically by the webServer.
 */

import { spawnSync } from "node:child_process";

function bun(args: string[], label: string) {
  const r = spawnSync("bun", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

export default function globalSetup() {
  if (!process.env.SKIP_BUILD) bun(["run", "build"], "plugin build");
  bun(["run", "tests/e2e/build-harness.ts"], "e2e host-shim build");
}
