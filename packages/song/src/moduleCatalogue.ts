// moduleCatalogue.ts — the workspace's shared `_modules`, listed for the module builder.
//
// GENERICS only: a node carries a channel or a preset, never a face — the loader
// ignores a `ui:` written on one — so a builder aimed at a node would edit nothing.
// The path is the file the builder opens; the substance comes from the ref map, so what is
// listed is exactly what a chain can name. Rationale: docs/moduleCatalogue.md.

import { moduleLabelOf } from "@studio/song-schema/moduleTypes";
import { loadModuleRefs, panelOf, splitModuleKey } from "./loader";
import { sharedRoots } from "./moduleFork";
import type { LoadedModule } from "./rawDoc";
import { moduleFileFor } from "./yaml/moduleIO";

export interface CatalogueModule {
  /** How a chain names it — "@engine/audio/delay/tape-delay". */
  ref: string;
  /** The part worth showing, namespace dropped — "audio/delay/tape-delay". */
  name: string;
  /** What a person calls it, when the module says — free text, never an identity (packages/song/docs/moduleLabel.md). */
  label?: string;
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
  /** How many nodes sit beside it (`module populate` files one per interface input). */
  nodes: number;
  /** It already has a `ui.yaml` beside it. */
  hasUi: boolean;
  /** Its panel grid, when it draws one — what the picker sizes a card by, docs/moduleCatalogue.md. */
  panel?: { cols: number; rows: number };
}

/** Every generic module the project inherits, in ref order; an unopenable one is dropped, docs/moduleCatalogue.md. */
export function moduleCatalogue(dir: string): CatalogueModule[] {
  const roots = sharedRoots(dir);
  const byNs = new Map(roots.map((r) => [r.ns, r.root]));

  // The same roots `sharedRoots` listed, both through `moduleLibraryDirs`, so they cannot disagree.
  const refs: Record<string, LoadedModule> = loadModuleRefs(dir);

  // The nodes are counted, not listed — they share their generic's panel and its ref.
  const nodes = new Map<string, number>();
  for (const key of Object.keys(refs)) {
    const { module, node } = splitModuleKey(key);
    if (node) nodes.set(module, (nodes.get(module) ?? 0) + 1);
  }

  const out: CatalogueModule[] = [];
  for (const [ref, m] of Object.entries(refs)) {
    if (!ref.startsWith("@") || splitModuleKey(ref).node) continue;
    const [ns, ...rest] = ref.slice(1).split("/");
    const plugin = m.plugin as { name?: unknown } | undefined;
    const root = byNs.get(ns);
    // A module the ENGINE provides has no folder to open, which is why `path` is optional.
    let path: string | undefined;
    if (root) {
      const file = moduleFileFor([root, ...rest].join("/"), "", "module");
      if (!file) continue;
      path = file.path;
    } else if (rest.length !== 1) {
      continue; // namespaced, no library root, and not an engine ref — nothing to show
    }
    const label = moduleLabelOf(m);
    const panel = panelOf(m);
    out.push({
      ref,
      name: rest.join("/"),
      ...(label ? { label } : {}),
      namespace: ns,
      category: String(m.category ?? rest[0] ?? ""),
      kind: String(m.kind ?? ""),
      plugin:
        plugin && typeof plugin === "object" && plugin.name
          ? String(plugin.name)
          : undefined,
      extends: m.extends ? String(m.extends) : undefined,
      path,
      nodes: nodes.get(ref) ?? 0,
      hasUi: !!m.ui,
      ...(panel ? { panel } : {}),
    });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}
