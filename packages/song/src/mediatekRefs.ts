// mediatekRefs.ts — which `@mediatek/…` modules a project actually names. The machine caches
// what its songs reach for rather than mirroring a whole catalogue, so something has to answer
// "which ones are those" — and it has to answer from the FILES, before the loader can resolve
// them, since a ref that resolves to nothing is exactly the one worth fetching.

import {
  loadChains,
  loadModules,
  loadProjectRoot,
  loadSongs,
  projectModules,
} from "./loader";
import { MEDIATEK_REF } from "./mediatekRoot";
import { splitModuleKey } from "./moduleTypes";
import type { ChainsFile } from "./yaml/chainsSchema";

const PREFIX = `${MEDIATEK_REF}/`;

/** The module half of a ref, or null when it isn't one of the médiathèque's. */
function mediatekModule(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return null;
  // A chain may name a NODE of a library module (`@mediatek/audio/x:warm`); the folder to
  // fetch is the module's, and the node travels inside it.
  const { module } = splitModuleKey(ref);
  return module.length > PREFIX.length ? module : null;
}

/**
 * Every `@mediatek/…` module this project names, sorted and deduplicated.
 *
 * Two ways a project reaches one, and both count: a module of its own that `extends` it —
 * the documented way to adjust a module you do not own — and a chain step naming it outright.
 * Read straight off the YAML rather than off `projectModules`, because the loader can only
 * report refs whose files are already on this machine, and the missing ones are the point.
 */
export function mediatekRefs(dir: string): string[] {
  const out = new Set<string>();

  for (const m of Object.values(loadModules(dir))) {
    const ref = mediatekModule(m.extends);
    if (ref) out.add(ref);
  }

  // chains.yaml declares SEGMENTS: a node names its next hops, and a library module can be
  // one of them — both as a key that exists before it is wired and as a destination. Read as
  // the file is shaped rather than through the derived chains, which would need the whole
  // graph model to answer a question about names.
  let chains: ChainsFile | null = null;
  try {
    chains = (loadChains(dir, loadProjectRoot(dir)) ??
      null) as ChainsFile | null;
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

  // …and what those modules extend in turn, since inheritance is how the library builds on
  // itself. Only as far as what is already on disk can say: a module fetched this round
  // reveals its own parent to the next one, which is one round late and never wrong.
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

/**
 * Every médiathèque SONG this project names — an m9 set's list, and empty for an l8 song.
 *
 * A thin wrapper over `loadSongs`, and here rather than left to callers because this file is
 * where "what does this project reach for" is answered, and a cache sync has exactly one
 * question to ask. The two halves stay SEPARATE functions returning separate vocabularies
 * (`modules/…` against `songs/…`): a module ref omits its family and a song ref carries one,
 * so a single merged list would need to be taken apart again by whoever fetches it.
 *
 * This is what the file is FOR. A set names forty songs; the machine that plays them opens
 * file paths, so all forty must be on its disk before the gig, and the venue has no wifi.
 * Read off the YAML before anything resolves it, for the reason the modules above are: a ref
 * that resolves to nothing is precisely the one worth fetching.
 */
export function mediatekSongRefs(dir: string): string[] {
  try {
    return loadSongs(dir);
  } catch {
    /* an unreadable set list costs the songs, never the modules */
    return [];
  }
}

/**
 * The library-relative folder a `@mediatek/…` ref lives in, with its trailing slash.
 *
 * `@mediatek/audio/filter/auto-wah` → `modules/audio/filter/auto-wah/`. A prefix rather than a
 * file list because a module IS its folder: the jsdsp source, the presets and the panel are as
 * much part of it as `module.yaml`, and a sync that fetched only the file named would land a
 * module that loads nothing.
 */
export function mediatekPathPrefix(ref: string): string {
  return `modules/${ref.slice(PREFIX.length)}/`;
}
