#!/usr/bin/env bun
/**
 * Minimal static file server for the E2E harness (no external deps).
 *
 * Serves the repo root so the harness page can load both the built bundle
 * (/dist/<id>/client/index.js) and the generated host shim. Used by the
 * Playwright webServer. Port via PORT (default 5599).
 */

import { join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 5599);

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".map": "application/json",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/tests/e2e/harness.html";
    // Prevent path traversal outside ROOT.
    const abs = normalize(join(ROOT, path));
    if (!abs.startsWith(ROOT)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(abs);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream" } });
  },
});

console.log(`[e2e] static server on http://127.0.0.1:${PORT}`);
