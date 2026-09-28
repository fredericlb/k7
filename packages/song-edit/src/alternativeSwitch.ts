// alternativeSwitch.ts — switching a module to another of its attribute SETS, and saying whether
// the switch reaches a running engine as plain VALUES. When the two sets differ in numeric params
// alone, the answer carries what to set, so the caller can patch the held project instead of
// recompiling it. See packages/song/docs/alternatives.md.

import { loadModuleRefs, loadModules } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import {
  type ParamsSwitch,
  paramsSwitch,
  setAlternative,
} from "@studio/song-schema/yaml/alternativeFile";
import { editModuleFile } from "./projectEdit";

/** The values a switch changed: a PATCH over the plugin's params, or the WHOLE of them when inheritance had to be resolved. */
export interface SwitchedParams {
  params: Record<string, number>;
  whole: boolean;
}

/** Switch a module's set by name; `values` is present only when the switch changed nothing but numbers. */
export function selectModuleAlternative(
  dir: string,
  module: string,
  name: string,
): { path: string; values?: SwitchedParams } {
  let sw: ParamsSwitch | null = null;
  const path = editModuleFile(dir, module, (text) => {
    sw = paramsSwitch(text, name);
    return setAlternative(text, name);
  });
  const found = sw as ParamsSwitch | null;
  if (!found) return { path };
  // The file said every value: no module has to be loaded, which is the whole saving.
  if (!found.inherited.length)
    return { path, values: { params: found.params, whole: false } };
  // A value comes from what the module extends, so it is resolved as the compile would resolve it.
  const node = loadModules(dir)[module];
  if (!node) return { path };
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    resolveModule(node, loadModuleRefs(dir)).params ?? {},
  ))
    if (typeof v === "number") params[k] = v;
  return { path, values: { params, whole: true } };
}
