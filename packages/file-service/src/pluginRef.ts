// Turning the friendly name for a plugin into the pair the engine takes. One rule, because three
// routes now ask the same question — what it HAS, what it looks like, and what it is holding.

import { scannedPlugins } from "@studio/engine-client/pluginCache";
import { engineModuleOf } from "@studio/song-schema/moduleTypes";

/** The pair, or the error to send. */
export type PluginRef =
  | { format: string; id: string }
  | { status: number; error: string };

/**
 * Two ways to name a plugin, resolved to the one the engine takes.
 *
 * `ref` is an `@engine/<slug>` — what a module's `extends:` carries — and only this side can turn
 * it into a binary, because the scan cache is here; a browser holding the ref would otherwise have
 * to fetch the whole catalogue to send back one path. `engineModuleOf` is the shared rule, so the
 * plugin found is the one a compiled document would load.
 *
 * Only EXTERNALS are in that cache, which is the filter as well as the lookup: a built-in resolves
 * to nothing here and never should, since it needs no engine to answer for it and draws no window.
 */
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
