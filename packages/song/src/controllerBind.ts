// controllerBind.ts — binding a CC to the module a CHAIN names ("synth", "synth:lead"), rather
// than to a module ref. A file of its own because the loader imports controller.ts to stamp every
// module with its map, so controller.ts must not import the loader back: the resolution that needs
// both lives here, where the dependency runs one way.

import type { CcBinding } from "@studio/song-schema/yaml/moduleSchema";
import { moduleFolderForRef, setCcBinding } from "./controller";
import { loadModules, moduleOwnRefs } from "./loader";
import type { LoadedModule } from "./rawDoc";

/** Bind or unbind a CC on a module a chain names, in the folder the PANEL came from — docs/controller.md. */
export function bindModuleCc(
  dir: string,
  module: string,
  param: string,
  binding: CcBinding | null,
): { rel: string; ref: string } {
  const modules = loadModules(dir) as Record<string, LoadedModule>;
  const m = modules[module];
  if (!m) throw new Error(`no module "${module}" in this project`);
  // First ref that actually HAS a folder; an engine module has none, which `module own` fixes.
  const ref = moduleOwnRefs(m).find((r) => moduleFolderForRef(dir, r));
  if (!ref)
    throw new Error(
      `module '${module}' has no folder to hold a controller map — run \`module own ${module}\` first`,
    );
  return { rel: setCcBinding(dir, ref, param, binding), ref };
}
