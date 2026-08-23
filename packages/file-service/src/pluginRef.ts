// Turning the friendly name for a plugin into the pair the engine takes. One rule, because three
// routes now ask the same question — what it HAS, what it looks like, and what it is holding.

import { scannedPlugins } from "@studio/engine-client/pluginCache";
import { engineModuleOf } from "@studio/song-schema/moduleTypes";

/** The pair, or the error to send. */
export type PluginRef =
  | { format: string; id: string }
  | { status: number; error: string };

/** Two ways to name a plugin, resolved here because the scan cache is; only EXTERNALS are in it. */
export function resolvePlugin(
  ref: string,
  format: string,
  id: string,
): PluginRef {
  if (ref) {
    const hit = scannedPlugins().find(
      (p) => p.id && engineModuleOf(p)?.ref === ref,
    );
    if (!hit?.id)
      return { status: 404, error: `no scanned plugin for "${ref}"` };
    return { format: hit.format, id: hit.id };
  }
  if (!format || !id)
    return { status: 400, error: "format and id, or ref, are required" };
  return { format, id };
}
