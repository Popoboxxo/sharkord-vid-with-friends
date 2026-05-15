/**
 * UI components index — re-exports all plugin slot components.
 *
 * Component map registered via ctx.ui.registerComponents() or exported as `components`.
 * Slot IDs follow the Sharkord Plugin SDK conventions.
 */

import type { JSX } from "react";
import { NowPlayingBadge } from "./display";
import { QueuePanel } from "./main";
import { SettingsPanel } from "./controls";

/** Minimal props passed to plugin slot components by Sharkord */
type SlotComponentProps = {
  channelId?: number;
  isPaused?: boolean;
  queueSize?: number;
  nowPlayingTitle?: string;
  preparationPhase?: "RESOLVING" | "PREPARING" | "BUFFERING" | "STREAMING";
  preparationProgress?: number;
  executeCommand?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  [key: string]: unknown;
};

type ComponentFactory = (props: SlotComponentProps) => JSX.Element | null;
type ComponentsMap = Record<string, ComponentFactory[]>;

export const components: ComponentsMap = {
  TOPBAR_RIGHT: [NowPlayingBadge],
  HOME_SCREEN: [QueuePanel],
  ADMIN_SETTINGS: [SettingsPanel],
};

export { NowPlayingBadge } from "./display";
export { QueuePanel } from "./main";
export { SettingsPanel } from "./controls";
