// install.ts — the SERVER half of plugin installation: commands and surface types, contributed
// to the registries that already exist. Runs wherever the command layer runs (the file-service
// boot today), ONCE, before anything reads a catalogue or compiles a song. The BROWSER half —
// pane drawers into the shell's ring — is the shell's composition point (apps/k7/frontend),
// which imports `@studio/k7-plugins/browser` and registers through its own registry: the
// drawer types are the shell's, and the SDK does not know them (docs/sdk.md).

import { registerVerb } from "@studio/commands/commandSpec";
import { registerSurfaceType } from "@studio/song-schema/yaml/surfaceRegistry";
import type { K7Plugin } from "./plugin";

/** Which plugin installed which SID — the attribution an uninstall (and a `who did this`) reads.
 *  Collision is already refused by the registries; this is the bookkeeping that survives it. */
const attribution = new Map<string, string>();

/** The plugin a SID came from, or undefined for a builtin's. */
export const pluginOf = (sid: string): string | undefined =>
  attribution.get(sid);

/** Contribute a plugin's server-side half. A SID may live in a CORE family — the normal case,
 *  `track.transcribe` in `track.*` — or under the plugin's own `plugin.<id>.*` prefix; either
 *  way it is attributed here, and a SID a plugin already claimed is refused, never shadowed. */
export function installServerSide(plugin: K7Plugin): void {
  for (const c of plugin.commands ?? []) {
    const claimed = attribution.get(c.sid);
    if (claimed)
      throw new Error(
        `command sid '${c.sid}' is already claimed by plugin '${claimed}' — plugin '${plugin.id}' cannot install it`,
      );
    registerVerb(c.spec, c.handler);
    attribution.set(c.sid, plugin.id);
  }
  for (const t of plugin.surfaceTypes ?? []) registerSurfaceType(t);
}

/** …and a list of them, which is what a composition point holds. */
export function installServerPlugins(plugins: readonly K7Plugin[]): void {
  for (const p of plugins) installServerSide(p);
}
