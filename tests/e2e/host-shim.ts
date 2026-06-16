/**
 * Browser-side host shim for the Playwright E2E harness.
 *
 * Bundled to tests/e2e/.generated/host-shim.js by global-setup. Reproduces what
 * the real Sharkord host provides to a plugin client bundle:
 *   - window.__SHARKORD_REACT__       (the host React instance, incl. jsx)
 *   - window.__SHARKORD_REACT_JSX__
 *   - a createRoot helper from react-dom/client
 *   - window.__SHARKORD_STORE__       (installed/controlled from the test)
 *
 * The plugin's built client bundle reads these globals exactly as in production.
 */

import * as React from "react";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";

declare global {
  interface Window {
    __SHARKORD_REACT__?: unknown;
    __SHARKORD_REACT_JSX__?: unknown;
    __SHARKORD_MOUNT__?: (el: HTMLElement, component: () => unknown) => Root;
  }
}

window.__SHARKORD_REACT__ = React;
window.__SHARKORD_REACT_JSX__ = { jsx, jsxs, Fragment };

window.__SHARKORD_MOUNT__ = (el, Component) => {
  const root = createRoot(el);
  root.render(React.createElement(Component as React.FC));
  return root;
};
