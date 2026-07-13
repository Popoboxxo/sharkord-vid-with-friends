#!/usr/bin/env bun
/**
 * Shared client-bundle builder for Sharkord plugins (v0.0.22).
 *
 * Bundles `src/client/index.tsx` into `<outdir>/client/index.js` as ESM, with
 * React aliased to the UI-Kit shims so the host's React instance is reused
 * (window.__SHARKORD_REACT__ / __SHARKORD_REACT_JSX__).
 *
 * Vendored copy lives at src/ui/kit/build-client.ts; canonical source is
 * sharkord-meta/templates/plugin-ui/. Call from a plugin's scripts/build.ts:
 *
 *   import { buildClient } from "../src/ui/kit/build-client";
 *   await buildClient({ entry: "src/client/index.tsx", outdir: "dist/<id>" });
 */

import { resolve, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

export interface BuildClientOptions {
  /** Client entry, e.g. "src/client/index.tsx". */
  entry: string;
  /** Plugin dist dir, e.g. "dist/sharkord-vid-with-friends". client/ is created inside. */
  outdir: string;
  /** Directory holding the vendored kit shims. Default: dirname of this file. */
  kitDir?: string;
  minify?: boolean;
}

export async function buildClient(opts: BuildClientOptions): Promise<void> {
  const kitDir = opts.kitDir ?? import.meta.dir;
  const reactShim = resolve(kitDir, "shims/react.ts");
  const jsxShim = resolve(kitDir, "shims/jsx-runtime.ts");
  const clientOut = join(opts.outdir, "client");
  mkdirSync(clientOut, { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve(opts.entry)],
    outdir: clientOut,
    target: "browser",
    format: "esm",
    minify: opts.minify ?? true,
    // Reuse host React: alias bare specifiers to the window-backed shims.
    plugins: [
      {
        name: "sharkord-react-shim",
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({ path: reactShim }));
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: jsxShim }));
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: jsxShim }));
          build.onResolve({ filter: /^react-dom(\/.*)?$/ }, () => ({
            path: resolve(kitDir, "shims/react.ts"),
          }));
        },
      },
    ],
  });

  if (!result.success) {
    console.error("Client build failed:");
    for (const log of result.logs) console.error(log);
    throw new Error("client build failed");
  }
  console.log(`✓ client bundle: ${clientOut}/index.js`);
}
