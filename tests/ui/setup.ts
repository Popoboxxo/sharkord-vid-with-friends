/**
 * UI test setup — registers a happy-dom environment globally so React + the
 * Sharkord UI-Kit render against a real DOM under `bun test`.
 *
 * Wired as a bun test preload (see bunfig.toml [test].preload). The happy-dom
 * globals MUST be registered before @testing-library/* is imported anywhere, so
 * the registration runs first and `cleanup` is required lazily afterwards.
 *
 * Canonical source target: sharkord-meta/templates/plugin-ui/testing/.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

if (!(globalThis as { __SHARKORD_UI_DOM__?: boolean }).__SHARKORD_UI_DOM__) {
  GlobalRegistrator.register();
  (globalThis as { __SHARKORD_UI_DOM__?: boolean }).__SHARKORD_UI_DOM__ = true;
}

// Require cleanup only after the DOM globals exist (testing-library binds to
// document at import time). Unmount rendered trees between tests so document.body
// never bleeds across tests/files — bun does not auto-wire this.
const { cleanup } = require("@testing-library/react") as typeof import("@testing-library/react");
afterEach(() => cleanup());
