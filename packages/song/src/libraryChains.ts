// libraryChains.ts — the chains the account's libraries hold, walked once for every caller that
// asks: a workspace (the chains builder), the account (st0's home page and k7's bench, which have
// no workspace open) and a bounce (`clip process`, `system stems`).
//
// The one thing a reader would get wrong: a chain is a FOLDER holding a graph file, at any depth
// under a library's `chains/`, and its ref is `@<library>/<path under chains/>`. A BARE path is
// the default library's, which is how every chain was named before libraries had names — see
// docs/sharedFolders.md.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LIBRARY,
  libraryRef,
  libraryRefParts,
} from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { libraryFamilyRoots } from "./sharedFolders";

/** One chain of a library: its ref (`@st0/bass/di`), which library and path that is, where it is, and the node files beside its graph. */
export interface LibraryChainDir {
  ref: string;
  library: string;
  path: string;
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

/** Every chain under ONE `chains/` folder, by path. An unreadable folder answers nothing rather than throwing. */
function walkChains(library: string, chainsRoot: string): LibraryChainDir[] {
  const out: LibraryChainDir[] = [];
  const walk = (at: string, path: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    // The graph file is what makes a folder a chain, so the walk stops there and never nests one inside another.
    if (entries.some((e) => e.isFile() && e.name === GRAPH_FILE)) {
      if (path)
        out.push({
          ref: libraryRef(library, path),
          library,
          path,
          dir: at,
          nodes: nodesIn(at),
        });
      return;
    }
    for (const e of entries)
      if (e.isDirectory())
        walk(join(at, e.name), path ? `${path}/${e.name}` : e.name);
  };
  walk(chainsRoot, "");
  return out;
}

/** Every chain of every library, by ref. */
export function libraryChainDirs(): LibraryChainDir[] {
  return libraryFamilyRoots("chains")
    .flatMap((l) => walkChains(l.name, l.root))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

/** `@<library>/<path>`, or a bare `<path>` in the default library, split — null when it names no chain folder at all. */
export function chainRefParts(
  ref: string,
): { library: string; path: string } | null {
  const trimmed = ref.trim().replace(/\/+$/, "");
  const parts = libraryRefParts(trimmed);
  const library = parts ? parts.library : DEFAULT_LIBRARY;
  const path = (parts ? parts.rest : trimmed).replace(/^\/+/, "");
  if (trimmed.startsWith("@") && !parts) return null; // `@engine/…`, `@workspace/…`: no library
  // A ref is a path under the family folder, so a `..` in it would reach out of the library.
  if (!path || path.split("/").some((s) => !s || s === "." || s === ".."))
    return null;
  return { library, path };
}

/** The chain `ref` names, bare or with its library, or undefined. */
export function findLibraryChain(ref: string): LibraryChainDir | undefined {
  const want = chainRefParts(ref);
  if (!want) return undefined;
  return libraryChainDirs().find(
    (c) => c.library === want.library && c.path === want.path,
  );
}
