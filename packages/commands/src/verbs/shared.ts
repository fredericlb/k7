// shared.ts — what a VERB GROUP needs and none of them owns.
//
// `commands.ts` carried 81 verbs and their tools in one 4755-line file. That file splits by entity
// (`verbs/system.ts`, `verbs/playlist.ts`, …), and this module is what the split dropped between
// the groups: a verb file imports from HERE, never from `commands.ts`, or the cycle would be real
// at runtime.
//
// The TYPES do come from `commands.ts` — an `import type` is erased, so it makes no cycle. That is
// what lets `CommandHost` stay where it is read.

import { resolve, sep } from "node:path";
import {
  isInputModule,
  isMidiInModule,
  type loadGraph,
} from "@studio/song/graph";
import { PLAYLISTS_DIR, playlistPathOf } from "@studio/song-schema/playlist";
import type { CommandHost } from "../commands.ts";

/** What the playlist verbs say with no workspace: they never fall back to `songPath`, docs/playlist.md. */
export const NO_WORKSPACE =
  "no workspace here — a playlist lives in the repository's _playlists/";

/** A command line's words — named because `node automate` once split on `/s+/`, the LETTER `s`. */
export function splitWords(a: string): string[] {
  return a.trim().split(/\s+/).filter(Boolean);
}

/** Where a playlist NAME lands, or a refusal — a workspace and containment, docs/playlist.md. */
export function playlistFile(
  name: string,
  h: CommandHost,
): { rel: string; abs: string } | null {
  const root = h.repoDir;
  if (!root) {
    h.refuse([NO_WORKSPACE]);
    return null;
  }
  const rel = playlistPathOf(name);
  const dir = resolve(root, PLAYLISTS_DIR);
  const abs = rel ? resolve(root, rel) : "";
  if (!rel || !(abs.startsWith(dir + sep) || abs === dir)) {
    h.refuse([
      `'${name}' is not a playlist name — it would leave ${PLAYLISTS_DIR}/`,
    ]);
    return null;
  }
  return { rel, abs };
}

/** Does the signal ARRIVING at `node` come off a live input, audio or MIDI? Walks UPSTREAM — docs/verbs.md. */
export function runCarriesInput(
  g: ReturnType<typeof loadGraph>,
  node: string,
): boolean {
  const bare = (s: string) => s.split("#")[0];
  const isLive = (name: string): boolean => {
    const b = g.modules[name];
    // A MIDI device lands on a lane too, its notes being what recording there captures (packages/song/docs/midiIn.md).
    return !!b && (isInputModule(g, b) || isMidiInModule(b));
  };
  // Who feeds whom: a chain is a linear run, and its `out` is how one chain reaches another.
  const feeders = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const at = feeders.get(bare(to));
    if (at) at.push(bare(from));
    else feeders.set(bare(to), [bare(from)]);
  };
  for (const c of Object.values(g.chains)) {
    const run = [...(c.from ? [c.from] : []), ...c.use.map((s) => s.module)];
    for (let i = 1; i < run.length; i++) link(run[i - 1], run[i]);
    const last = run[run.length - 1];
    if (last) for (const o of c.out) link(last, o.to);
  }
  // …then back up from `node`, itself included; `seen` is not an optimisation, a graph may hold a cycle.
  const seen = new Set<string>();
  const stack = [bare(node)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    if (isLive(n)) return true;
    for (const f of feeders.get(n) ?? []) stack.push(f);
  }
  return false;
}
