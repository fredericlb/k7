// externalPlugins.ts — whether a project names a plugin only the engine's SCAN can know: a module
// whose plugin is an external format, or an `@engine/…` ref that is not a built-in. A built-in is
// known without a scan, so a project using only those never waits for one. What a reader would get
// wrong: an UNRESOLVED engine ref counts — it is what a stale scan makes of a newly installed plugin.
// See docs/enginePlugin.md.

import { EXTERNAL_PLUGIN_FORMATS } from "@studio/engine-protocol/build";
import { engineModuleOf, isEngineRef } from "@studio/song-schema/moduleTypes";
import { type CompileInputs, loadCompileInputs } from "./compile/inputs";
import { builtinScan } from "./engineCatalogue";
import type { LoadedModule } from "./rawDoc";

/** The refs every engine has, scanned or not. */
const builtinRefs = (): Set<string> =>
  new Set(
    builtinScan().flatMap((p) => {
      const named = engineModuleOf(p);
      return named ? [named.ref] : [];
    }),
  );

const isExternal = (m: LoadedModule | undefined): boolean =>
  EXTERNAL_PLUGIN_FORMATS.has(
    String(
      (m?.plugin as { type?: unknown } | undefined)?.type ?? "",
    ).toLowerCase(),
  );

/** Whether `name` reaches an external plugin, its `extends` followed to the end — or stops at an engine ref nothing resolves. */
function reachesExternal(
  name: string,
  inp: Pick<CompileInputs, "localModules" | "moduleRefs">,
  builtins: Set<string>,
): boolean {
  const unknownEngine = (ref: string) => isEngineRef(ref) && !builtins.has(ref);
  let m: LoadedModule | undefined =
    inp.localModules[name] ?? inp.moduleRefs[name];
  if (!m) return unknownEngine(name);
  const seen = new Set<string>([name]);
  for (;;) {
    if (isExternal(m)) return true;
    const ref: string = m.extends ? String(m.extends) : "";
    if (!ref || seen.has(ref)) return false;
    seen.add(ref);
    const parent: LoadedModule | undefined = inp.moduleRefs[ref];
    if (!parent) return unknownEngine(ref);
    m = parent;
  }
}

/** …over inputs already read: every module the project holds and every one its chains name. */
export function inputsNameExternalPlugin(
  inp: Pick<
    CompileInputs,
    "localModules" | "moduleRefs" | "chains" | "modulesMap"
  >,
): boolean {
  // Resolved first: a module's set or engine choice can make it an external one (docs/moduleResolve.md).
  if (Object.values(inp.modulesMap).some((m) => isExternal(m))) return true;
  const names = new Set(Object.keys(inp.localModules));
  for (const c of Object.values(inp.chains)) {
    for (const s of c.use) names.add(String(s?.module ?? ""));
    for (const o of c.out ?? []) names.add(String(o?.to ?? ""));
  }
  names.delete("");
  const builtins = builtinRefs();
  for (const name of names)
    if (reachesExternal(name, inp, builtins)) return true;
  return false;
}

/** Whether the project at `dir` names an external plugin; false for one that cannot be read, which opens as it would have. */
export function namesExternalPlugin(dir: string): boolean {
  try {
    return inputsNameExternalPlugin(loadCompileInputs(dir));
  } catch {
    return false;
  }
}
