/**
 * JSX runtime shim — maps `react/jsx-runtime` to the host's runtime.
 *
 * Alias `react/jsx-runtime` (and `react/jsx-dev-runtime`) to this file so the
 * automatic JSX transform uses the host React exposed on
 * `window.__SHARKORD_REACT_JSX__`.
 *
 * Canonical source: sharkord-meta/templates/plugin-ui/shims/.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = (globalThis as any).window ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runtime: any = w.__SHARKORD_REACT_JSX__ ?? w.__SHARKORD_REACT_JSX_DEV__ ?? {};

if (!w.__SHARKORD_REACT_JSX__) {
  // eslint-disable-next-line no-console
  console.error("[sharkord-plugin-ui] window.__SHARKORD_REACT_JSX__ missing — host did not expose the JSX runtime.");
}

export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const jsxDEV = runtime.jsxDEV ?? runtime.jsx;
export const Fragment = runtime.Fragment;
