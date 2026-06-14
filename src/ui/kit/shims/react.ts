/**
 * React shim — maps `react` imports to the host's React instance.
 *
 * Plugin client bundles MUST NOT ship their own React. At build time, alias
 * `react` to this file so every `import … from "react"` resolves to the host
 * React exposed on `window.__SHARKORD_REACT__`. This guarantees one React
 * instance (hooks work) and a tiny bundle.
 *
 * Canonical source: sharkord-meta/templates/plugin-ui/shims/.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const React: any = (globalThis as any).window?.__SHARKORD_REACT__;

if (!React) {
  // eslint-disable-next-line no-console
  console.error("[sharkord-plugin-ui] window.__SHARKORD_REACT__ missing — host did not expose React.");
}

export default React;

export const useState = React?.useState;
export const useEffect = React?.useEffect;
export const useRef = React?.useRef;
export const useMemo = React?.useMemo;
export const useCallback = React?.useCallback;
export const useReducer = React?.useReducer;
export const useContext = React?.useContext;
export const createElement = React?.createElement;
export const Fragment = React?.Fragment;
export const memo = React?.memo;
export const forwardRef = React?.forwardRef;
export const createContext = React?.createContext;
