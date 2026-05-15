/**
 * Plugin entry point — sharkord-vid-with-friends.
 *
 * Exports: default PluginConfig, onLoad, onUnload, components
 */
import { PluginConfig, PluginContext } from "@sharkord/plugin-sdk";
import { onLoad, onUnload, components } from "./plugin-lifecycle";

export { onLoad, onUnload, components };

export default function plugin(context: PluginContext): PluginConfig {
  context.log(`🔌 sharkord-vid-with-friends loaded`);

  return {
    name: "sharkord-vid-with-friends",
    version: "0.1.0-alpha.10",
    onLoad() {
      return onLoad(context as unknown as import("./utils/settings").PluginContext);
    },
    onUnload() {
      return onUnload(context as unknown as import("./utils/settings").PluginContext);
    },
  };
}
