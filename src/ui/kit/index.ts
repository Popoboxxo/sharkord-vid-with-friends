/**
 * Sharkord Plugin UI-Kit — public entry.
 *
 * Vendored into each plugin under src/ui/kit/. Import primitives + store helpers
 * from here in your src/client/index.tsx slot components.
 *
 * Canonical source: sharkord-meta/templates/plugin-ui/.
 */

export { tokens } from "./tokens";
export type { Tokens } from "./tokens";
export { Badge, StatusDot, Card, Button, IconButton, Panel, List } from "./primitives";
export { getStore, callAction, useSharkordState } from "./store";
export type { SharkordState, SharkordStore } from "./store";
