// plugins.ts — the shell's BROWSER composition point: the browser half of k7's builtin
// plugins, registered into the pane registry. Imported by App for its side effect, so the
// registration lands in the App chunk (the registry's seed imports the same components the
// shell already pulls) and never in the eager appMain chunk. See packages/k7-sdk/docs/sdk.md.

import { builtinBrowserPlugins } from "@studio/k7-plugins/browser";
import type { PaneDrawerContribution } from "@studio/k7-sdk/plugin";
import {
  type DeviceSurfaceDrawer,
  registerSurfacePane,
  type ShellPaneDrawer,
} from "./surfacePanes";
import { seedSurfacePanes } from "./surfacePanesSeed";

// The builtins' four drawers first — the registry refuses a second registration, so the seed
// IS the vocabulary, and a plugin's contribution cannot shadow the shell's own.
seedSurfacePanes();

for (const p of builtinBrowserPlugins()) {
  for (const pane of p.panes ?? []) {
    // The SDK's contribution takes `never` (a drawer typed where it is MOUNTED); this registry
    // is the mount, so the narrowing is here and nowhere else — docs/sdk.md. ONE drawer serves
    // both mounts today: the ring slot and a device hand it overlapping ctx, and the drawer
    // takes the subset it needs. Distinct per-mount drawers are a phase-4 fork of this loop.
    // The SDK's contribution takes `never` (a drawer typed where it is MOUNTED); this registry
    // is the mount, so the narrowing is here and nowhere else — docs/sdk.md. ONE drawer serves
    // both mounts today: the ring slot and a device hand it overlapping ctx, and the drawer
    // takes the subset it needs. Distinct per-mount drawers are a phase-4 fork of this loop.
    const contribution = pane as unknown as PaneDrawerContribution;
    registerSurfacePane({
      type: contribution.type,
      pane: contribution.drawer as unknown as ShellPaneDrawer,
      device: contribution.drawer as unknown as DeviceSurfaceDrawer,
    });
  }
}
