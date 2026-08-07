// baseModules.ts — what a médiathèque module may `extends:`, asked of the chosen engine.
// The refs are DERIVED from its plugin catalogue, exactly as engineCatalogue.ts derives them
// off disk on the machine, so the two spellings cannot drift. See docs/completion.md.

import type { EngineClient, EnginePluginInfo } from "@studio/engine-browser";
import { engineRef, slugifyPluginName } from "@studio/song/moduleTypes";
import { useEffect, useState } from "react";

/**
 * The engine's plugins as module refs — `@engine/neural-amp-modeler`.
 *
 * `slugifyPluginName` and `engineRef` come from `@studio/song/moduleTypes`, the leaf with no
 * `node:fs` in it, which exists so a browser can name an engine module without dragging the
 * scan reader in behind it. Same rules as `engineModules()`: an unsluggable name is skipped,
 * and the first of two scans of one plugin wins.
 *
 * The io modules that catalogue also synthesises (`@engine/IN`, `OUT`, `FILE`) are deliberately
 * absent: they are usable directly and are not `extends` targets.
 */
export function baseModuleRefs(plugins: EnginePluginInfo[]): string[] {
  const refs = new Set<string>();
  for (const p of plugins) {
    const slug = slugifyPluginName(p.name ?? "");
    if (slug) refs.add(engineRef(slug));
  }
  return [...refs].sort();
}

/**
 * Those refs, for the engine this screen is on. Empty while none answers.
 *
 * Asked on every (re)connection rather than once: the catalogue is the MACHINE's, so a
 * different engine has a different one, and a rescan on the machine changes it under us.
 * `listPlugins` reads the engine's cache and starts no scan, so the question is cheap.
 */
export function useBaseModules(
  client: EngineClient | null,
  connected: boolean,
): string[] {
  const [refs, setRefs] = useState<string[]>([]);
  useEffect(() => {
    if (!client) return setRefs([]);
    const off = client.onPlugins((list) => setRefs(baseModuleRefs(list)));
    if (connected) client.listPlugins();
    return off;
  }, [client, connected]);
  return refs;
}
