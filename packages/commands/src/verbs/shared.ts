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
