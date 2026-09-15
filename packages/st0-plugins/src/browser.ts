// browser.ts — the BROWSER composition half: what the shell registers into its pane ring at
// mount. It imports NO server half — the whisper verb stays out of the browser's program.

import type { St0Plugin } from "@studio/st0-sdk/plugin";
import { turntablesPlugin } from "./turntables";
import { videoPlugin } from "./video";

export const BROWSER_PLUGINS: St0Plugin[] = [turntablesPlugin, videoPlugin];

export function builtinBrowserPlugins(): readonly St0Plugin[] {
  return BROWSER_PLUGINS;
}
