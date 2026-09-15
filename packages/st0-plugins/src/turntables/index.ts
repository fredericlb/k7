// index.ts — the turntables plugin: the DESK. It contributes the drawer that draws a
// `turntables` surface, in the shell's pane ring and on a device (the same component serves
// both). The surface TYPE is a builtin of the schema, so there is nothing to register there;
// what is the plugin's is the drawing of it. No server half — the desk contributes no command.

import { definePlugin, type St0Plugin } from "@studio/st0-sdk/plugin";
import { TurntablesPane } from "./browser";

export const turntablesPlugin: St0Plugin = definePlugin({
  id: "turntables",
  panes: [
    {
      type: "turntables",
      // The drawer takes the subset of both mounts' ctx it needs; `never` accepts it.
      drawer: TurntablesPane,
    },
  ],
});
