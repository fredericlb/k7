// mediatekRefs.ts — which `@k7-core/…` modules a project actually names. The machine caches
// what its songs reach for rather than mirroring a whole catalogue, so something has to answer
// "which ones are those" — and it has to answer from the FILES, before the loader can resolve
// them, since a ref that resolves to nothing is exactly the one worth fetching.

import { join } from "node:path";
import { splitModuleKey } from "@studio/song-schema/moduleTypes";
import { parsePlaylist, playlistPathOf } from "@studio/song-schema/playlist";
import { songRefOf } from "@studio/song-schema/songRef";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import {
  loadChains,
  loadModules,
  loadProjectRoot,
  projectModules,
} from "./loader";
import { MEDIATEK_REF } from "./mediatekRoot";
import { projectSurfaces } from "./surfaces";
import { wsRead } from "./yaml/workspaceFile";

const PREFIX = `${MEDIATEK_REF}/`;

/** The module half of a ref, or null when it isn't one of the médiathèque's. */
function mediatekModule(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return null;
  // A chain may name a NODE of a library module; the folder to fetch is the module's.
  const { module } = splitModuleKey(ref);
  return module.length > PREFIX.length ? module : null;
}

/** Every `@k7-core/…` module this project names, read off the YAML — see docs/sharedFolders.md. */
export function mediatekRefs(dir: string): string[] {
  const out = new Set<string>();

  for (const m of Object.values(loadModules(dir))) {
    const ref = mediatekModule(m.extends);
    if (ref) out.add(ref);
  }

  // Read as the graph FILE is shaped, not through the derived chains — see docs/sharedFolders.md.
  let chains: GraphFile | null = null;
  try {
    chains = (loadChains(dir, loadProjectRoot(dir)) ??
      null) as GraphFile | null;
  } catch {
    /* an unreadable header costs the chain half, never the module half */
  }
  const named: unknown[] = [
    // A `modules:` key is a node that exists whether or not anything is wired to it yet.
    ...Object.keys(chains?.modules ?? {}),
    ...Object.values(chains?.modules ?? {}).flat(),
    ...(chains?.bypassed ?? []),
  ];
  for (const name of named) {
    const ref = mediatekModule(name);
    if (ref) out.add(ref);
  }

  // …and what those extend in turn, as far as what is on disk can say — one round late, never wrong.
  const known = projectModules(dir);
  const queue = [...out];
  while (queue.length) {
    const parent = mediatekModule(known[queue.pop() as string]?.extends);
    if (parent && !out.has(parent)) {
      out.add(parent);
      queue.push(parent);
    }
  }

  return [...out].sort();
}

/** Every médiathèque SONG this project names — the desk's playlist, at the WORKSPACE root, docs/sharedFolders.md. */
export function mediatekSongRefs(dir: string, workspace: string): string[] {
  let name: string | undefined;
  try {
    name = projectSurfaces(dir).surfaces.find(
      (s) => s.surface.type === "turntables",
    )?.surface.playlist;
  } catch {
    return []; // an unreadable surfaces/ costs the songs, never the modules
  }
  if (!name) return [];
  const rel = playlistPathOf(name);
  if (!rel) return [];

  let text: string;
  try {
    text = wsRead(join(workspace, rel));
  } catch {
    return []; // a playlist that is not there is the desk's message to give, not this loop's
  }
  const items = parsePlaylist(text)?.items ?? [];
  const out = new Set<string>();
  for (const item of items) {
    const ref = item.song.replace(/^\/+|\/+$/g, "");
    // The path form only: a bare title needs the catalogue, and this runs to POPULATE it.
    if (ref.includes("/")) out.add(songRefOf(`songs/${ref}`));
  }
  return [...out].sort();
}

/** The library-relative FOLDER a `@k7-core/…` ref lives in, since a module is its folder — docs/sharedFolders.md. */
export function mediatekPathPrefix(ref: string): string {
  return `modules/${ref.slice(PREFIX.length)}/`;
}
