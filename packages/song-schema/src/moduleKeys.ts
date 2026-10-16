// moduleKeys.ts — how a module and its node are KEYED: `module:node`, the bare ref, the key a
// path points into, and a plugin's slug. Re-exported by moduleTypes.ts; see docs/loader.md.
// Its import of MODULE_TYPES is a cycle with moduleTypes.ts, safe as only function bodies read it.

import { MODULE_TYPES } from "./moduleTypes";

// --- module nodes (see docs/loader.md) --------------------------------------
export const NODE_SEP = ":";

// The map key / chain reference for a module, with or without a node.
export const moduleKey = (module: string, node?: string): string =>
  node ? `${module}${NODE_SEP}${node}` : module;

// The bare form of a module's ref; an io module carries no type folder in its (docs/moduleTypes.md).
export const moduleRefOf = (type: string, name: string): string =>
  MODULE_TYPES[type]?.kind === "io" ? name : `${type}/${name}`;

/** The chain KEY of the module a path points into — everything between the type folder and the filename, docs/moduleTypes.md. */
export function moduleKeyFromPath(path: string): string | null {
  const segs = path.split(/[\\/]+/);
  // The LAST `modules/`, so a workspace-relative path and an absolute one land on the same segment.
  const at = segs.lastIndexOf("modules");
  if (at < 0) return null;
  const rest = segs.slice(at + 1);
  // <type> … <file>: at least a type, a module folder and a file.
  if (rest.length < 3 || !MODULE_TYPES[rest[0]]) return null;
  return rest.slice(1, -1).join("/");
}

// "synth:lead" -> {module, node}, splitting on the FIRST separator so it stays total on any key.
export function splitModuleKey(key: string): {
  module: string;
  node?: string;
} {
  const i = key.indexOf(NODE_SEP);
  return i < 0
    ? { module: key }
    : { module: key.slice(0, i), node: key.slice(i + 1) };
}

/** A plugin's real name as a filesystem- and ref-safe slug: "Neural Amp Modeler" -> "neural-amp-modeler". */
export function slugifyPluginName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
