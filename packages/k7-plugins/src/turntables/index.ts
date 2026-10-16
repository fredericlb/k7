// index.ts — the turntables plugin: the DESK. It contributes the drawer that draws a
// `turntables` surface, in the shell's pane ring and on a device (the same component serves
// both). The surface TYPE is a builtin of the schema, so there is nothing to register there;
// what is the plugin's is the drawing of it. No server half — the desk contributes no command.
// The drawer is LAZY: a project with no desk never downloads it (../lazyDrawer.tsx).

import { definePlugin, type K7Plugin } from "@studio/k7-sdk/plugin";
import { lazyDrawer } from "../lazyDrawer";

const TurntablesPane = lazyDrawer(() =>
  import("./browser").then((m) => m.TurntablesPane),
);

export const turntablesPlugin: K7Plugin = definePlugin({
  id: "turntables",
  panes: [
    {
      type: "turntables",
      // The drawer takes the subset of both mounts' ctx it needs; `never` accepts it.
      drawer: TurntablesPane,
    },
  ],
});
