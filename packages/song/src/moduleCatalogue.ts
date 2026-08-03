// moduleCatalogue.ts — the workspace's shared `_modules`, listed for the module builder.
//
// GENERICS only: an instance carries a channel or a preset, never a face — the loader
// ignores a `ui:` written on one — so a builder aimed at an instance would edit nothing.
// The path is the file the builder opens; the substance comes from the ref map, so what is
// listed is exactly what a chain can name. Rationale: docs/moduleCatalogue.md.

import { loadModuleRefs, splitModuleKey } from "./loader";
import { sharedRoots } from "./moduleFork";
import type { LoadedModule } from "./rawDoc";
import { moduleFileFor } from "./yaml/moduleIO";

export interface CatalogueModule {
  /** How a chain names it — "@engine/audio/delay/tape-delay". */
  ref: string;
  /** The part worth showing, namespace dropped — "audio/delay/tape-delay". */
  name: string;
  /** The catalogue it came from. */
  namespace: string;
  /** Its type folder (io|instruments|audio|transformers|midi|video_*). */
  category: string;
  /** What it IS, as the type folder decides — plugin, rack, io… */
  kind: string;
  /** The plugin it loads, for display; absent for a rack or a bare io module. */
  plugin?: string;
  /** The base it extends, when it has one. */
  extends?: string;
  /** ABSOLUTE path of the module file the builder edits. Absent for an ENGINE module: it has no file. */
  path?: string;
  /** How many instances sit beside it (`module populate` files one per interface input). */
  instances: number;
  /** It already has a `ui.yaml` beside it. */
  hasUi: boolean;
}

/**
 * Every generic module of the shared catalogues this project inherits, in ref order.
 *
 * A module with no readable file is dropped rather than listed: the builder's one job is to
 * open it, and an entry that cannot be opened is a row that only ever reports an error.
 */
export function moduleCatalogue(dir: string): CatalogueModule[] {
  const roots = sharedRoots(dir);
  const byNs = new Map(roots.map((r) => [r.ns, r.root]));

  let refs: Record<string, LoadedModule>;
  try {
    refs = loadModuleRefs(
      dir,
      roots.map((r) => r.root),
    );
  } catch {
    return []; // a broken catalogue costs the list, not the settings panel
  }

  // The instances are counted, not listed — they share their generic's panel and its ref.
  const instances = new Map<string, number>();
  for (const key of Object.keys(refs)) {
    const { module, instance } = splitModuleKey(key);
    if (instance) instances.set(module, (instances.get(module) ?? 0) + 1);
  }

  const out: CatalogueModule[] = [];
  for (const [ref, m] of Object.entries(refs)) {
    if (!ref.startsWith("@") || splitModuleKey(ref).instance) continue;
    // `@project/…` is the explicit spelling of a module the project owns, keyed beside its bare
    // name so both resolve. It is not a CATALOGUE though — this list is what the project inherits
    // from elsewhere, and its own modules are already the thing doing the inheriting.
    if (ref.startsWith("@project/")) continue;
    const [ns, ...rest] = ref.slice(1).split("/");
    const plugin = m.plugin as { name?: unknown } | undefined;
    const root = byNs.get(ns);
    // A module the ENGINE provides has no folder to open — that is the whole point, and
    // it is why `path` is optional. One from a shared LIBRARY does, and the builder edits
    // it; an entry whose file cannot be found is dropped rather than listed as a row that
    // only ever reports an error.
    let path: string | undefined;
    if (root) {
      const file = moduleFileFor([root, ...rest].join("/"), "", "module");
      if (!file) continue;
      path = file.path;
    } else if (rest.length !== 1) {
      continue; // namespaced, no library root, and not an engine ref — nothing to show
    }
    out.push({
      ref,
      name: rest.join("/"),
      namespace: ns,
      category: String(m.category ?? rest[0] ?? ""),
      kind: String(m.kind ?? ""),
      plugin:
        plugin && typeof plugin === "object" && plugin.name
          ? String(plugin.name)
          : undefined,
      extends: m.extends ? String(m.extends) : undefined,
      path,
      instances: instances.get(ref) ?? 0,
      hasUi: !!m.ui,
    });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}
