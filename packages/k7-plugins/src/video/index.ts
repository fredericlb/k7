// index.ts — the video plugin: the frame. It owns the viewport's drawing — the WebGL canvas
// over @studio/ui-eyes, the scene compiler, the shader-audio levels, the lens transport and the
// picture-mix arithmetic — and contributes the drawer that draws a `viewport` surface, in the
// shell's floating window and on a device. `sceneOf` and `ViewportTab` are exported for the shell's
// own panes (the export flow renders the scene too). Both drawers are LAZY, the compositor being
// fetched only by a project that draws a picture (../lazyDrawer.tsx). See ../../docs/plugins.md.

import { definePlugin, type K7Plugin } from "@studio/k7-sdk/plugin";
import { memo } from "react";
import { lazyDrawer } from "../lazyDrawer";

export const ViewportPane = lazyDrawer(() =>
  import("./ViewportPane").then((m) => m.ViewportPane),
);
// Memoised: the shell's floating window stays mounted while hidden, under an App that re-renders on every caret move.
export const ViewportTab = memo(
  lazyDrawer(() => import("./ViewportTab").then((m) => m.ViewportTab)),
);

export const videoPlugin: K7Plugin = definePlugin({
  id: "video",
  panes: [{ type: "viewport", drawer: ViewportPane }],
});

export { sceneOf } from "./scene";
export { pushShaderParam } from "./shaderLive";
export type { ViewportTabProps } from "./ViewportTab";
