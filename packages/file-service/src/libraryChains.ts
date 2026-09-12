// libraryChains.ts — the chains a library repository holds, walked once for the two callers that
// ask: a workspace (the chains builder) and the ACCOUNT (st0's home page, which has no workspace
// open and reads the bench's clone instead).
//
// The one thing a reader would get wrong: a chain is a FOLDER holding a graph file, at any depth
// under `chains/`, and the ref is the path under it. See docs/libraries.md.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";

/** One chain of the library: its ref (`bass/di`), where it is, and the node files beside its graph. */
export interface LibraryChainDir {
  ref: string;
  dir: string;
  nodes: string[];
}

/** A chain's node files by NAME; a chain with no `nodes/` yet is a real state, so never a throw. */
function nodesIn(at: string): string[] {
  try {
    return readdirSync(join(at, "nodes"), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every chain under `chainsRoot`, by ref. An unreadable folder answers nothing rather than throwing. */
export function walkLibraryChains(chainsRoot: string): LibraryChainDir[] {
  const out: LibraryChainDir[] = [];
  const walk = (at: string, ref: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    // The graph file is what makes a folder a chain, so the walk stops there and never nests one inside another.
    if (entries.some((e) => e.isFile() && e.name === GRAPH_FILE)) {
      if (ref) out.push({ ref, dir: at, nodes: nodesIn(at) });
      return;
    }
    for (const e of entries)
      if (e.isDirectory())
        walk(join(at, e.name), ref ? `${ref}/${e.name}` : e.name);
  };
  walk(chainsRoot, "");
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}
