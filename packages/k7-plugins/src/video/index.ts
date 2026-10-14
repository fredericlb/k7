// index.ts — the video plugin: the frame. It owns the viewport's drawing — the WebGL canvas
// over @studio/ui-eyes, the scene compiler, the shader-audio levels, the lens transport and the
// picture-mix arithmetic — and contributes the drawer that draws a `viewport` surface, in the
// shell's floating window and on a device. `sceneOf` and `ViewportTab` are exported for the shell's
// own panes (the export flow renders the scene too). See packages/k7-plugins/docs/plugins.md.

import { definePlugin, type K7Plugin } from "@studio/k7-sdk/plugin";
import { ViewportPane } from "./ViewportPane";

export const videoPlugin: K7Plugin = definePlugin({
  id: "video",
  panes: [{ type: "viewport", drawer: ViewportPane }],
});

export { sceneOf } from "./scene";
export { ViewportPane, ViewportTab } from "./ViewportPane";
