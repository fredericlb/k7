// engineSwitch.ts — running a module as another of its ENGINES, by writing `engine:` on the
// attribute set that is on. The names are asked of the RESOLVED module: a node lists no engines
// of its own, it inherits them from the module whose folder holds them. Always a reload, since
// another engine is another plugin. See packages/song/docs/engines.md.

import { loadModuleRefs, loadModules } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import { currentEngine, engineNames } from "@studio/song-schema/engines";
import { setAlternativeField } from "@studio/song-schema/yaml/alternativeFile";
import { editModuleFile } from "./projectEdit";

/** What a module can run as, and which one it does — empty when it has no engines. */
export function moduleEngines(
  dir: string,
  module: string,
): { names: string[]; current?: string } {
  const node = loadModules(dir)[module];
  if (!node) throw new Error(`no module named '${module}'`);
  const resolved = resolveModule(node, loadModuleRefs(dir));
  return { names: engineNames(resolved), current: currentEngine(resolved) };
}

/** Switch a module to one of its engines; refused for a name it has not got. */
export function selectModuleEngine(
  dir: string,
  module: string,
  name: string,
): { path: string } {
  const { names } = moduleEngines(dir, module);
  if (!names.length) throw new Error(`${module} has no engines`);
  if (!names.includes(name))
    throw new Error(
      `${module} has no engine '${name}' — it has ${names.join(", ")}`,
    );
  const path = editModuleFile(dir, module, (doc) =>
    setAlternativeField(doc, "engine", name),
  );
  return { path };
}
