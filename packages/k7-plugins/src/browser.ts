// browser.ts — the BROWSER composition half: what the shell registers into its pane ring at
// mount. It imports NO server half — the whisper verb stays out of the browser's program.

import type { K7Plugin } from "@studio/k7-sdk/plugin";
import { turntablesPlugin } from "./turntables";
import { videoPlugin } from "./video";

export const BROWSER_PLUGINS: K7Plugin[] = [turntablesPlugin, videoPlugin];

export function builtinBrowserPlugins(): readonly K7Plugin[] {
  return BROWSER_PLUGINS;
}
