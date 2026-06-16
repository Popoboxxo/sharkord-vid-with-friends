#!/usr/bin/env bun
/**
 * Builds the E2E harness artifacts (run under Bun, invoked by global-setup):
 *   - host-shim.ts -> tests/e2e/.generated/host-shim.js (browser ESM)
 *
 * The plugin client bundle itself is produced by `bun run build` separately.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outdir = join(import.meta.dir, ".generated");
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "host-shim.ts")],
  outdir,
  target: "browser",
  format: "esm",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`✓ e2e host-shim: ${outdir}/host-shim.js`);
