#!/usr/bin/env bun
/**
 * Native Sharkord v0.0.22 build — sharkord-vid-with-friends.
 *
 * Emits the native plugin layout (no post-build transform needed):
 *   dist/<id>/server/index.js   — from src/server/index.ts (named onLoad/onUnload)
 *   dist/<id>/client/index.js   — from src/client/index.tsx (components, host React)
 *   dist/<id>/manifest.json     — zPluginManifest (sdkVersion: 1)
 *   dist/<id>/logo.png          — optional
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { buildClient } from "../src/ui/kit/build-client";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const PLUGIN_NAME: string = pkg.name;
const OUTDIR = `dist/${PLUGIN_NAME}`;

const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/.+/.test(s);

async function main() {
  if (existsSync("dist")) await Bun.$`rm -rf dist`;
  mkdirSync(join(OUTDIR, "server"), { recursive: true });

  // --- server bundle ---
  const server = await Bun.build({
    entrypoints: ["src/server/index.ts"],
    outdir: join(OUTDIR, "server"),
    target: "bun",
    format: "esm",
    minify: true,
  });
  if (!server.success) {
    console.error("Server build failed:", server.logs);
    process.exit(1);
  }
  console.log(`✓ server bundle: ${OUTDIR}/server/index.js`);

  // --- client bundle (React aliased to host via UI-Kit shims) ---
  await buildClient({ entry: "src/client/index.tsx", outdir: OUTDIR });

  // --- manifest.json (zPluginManifest) ---
  const sk = pkg.sharkord ?? {};
  const manifest: Record<string, unknown> = {
    id: PLUGIN_NAME,
    name: sk.name || "Vid With Friends",
    author: sk.author || "Unknown",
    description: (sk.description || pkg.description || PLUGIN_NAME).trim(),
    sdkVersion: 1,
    version: pkg.version,
  };
  if (isUrl(sk.homepage || pkg.homepage)) manifest.homepage = sk.homepage || pkg.homepage;
  if (isUrl(sk.logo)) manifest.logo = sk.logo;
  writeFileSync(join(OUTDIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest.json (v${manifest.version}, sdk=1)`);

  // --- logo ---
  if (existsSync("logo.png")) copyFileSync("logo.png", join(OUTDIR, "logo.png"));

  console.log(`\n✓ Native v0.0.22 build complete: ${OUTDIR}/`);
}

main();
