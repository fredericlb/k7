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

/** What the playlist verbs say with no workspace under them. They act on `repoDir` and never fall
 *  back to `songPath` the way the git verbs do: `_playlists/` at the project root would be a
 *  second, invisible set of set lists — one per song, which is the shape they exist to avoid. */
export const NO_WORKSPACE =
  "no workspace here — a playlist lives in the repository's _playlists/";

/**
 * A command line's words.
 *
 * `node automate` split on `/s+/` — the LETTER `s`, not whitespace. "osc Filter Freq sweep" came
 * apart as `["o", "c Filter Freq ", "weep"]`, and a line containing no `s` at all yielded one word
 * and was refused with the usage text. The verb failed for essentially every input, and nothing
 * tested it. Named here so the next handler that needs words borrows this rather than a regex.
 */
export function splitWords(a: string): string[] {
  return a.trim().split(/\s+/).filter(Boolean);
}

/**
 * Where a playlist NAME lands, or a refusal.
 *
 * Both playlist verbs go through this, so "where does `live/repet` live" is answered once. Two
 * things have to be true and each is refused by name: there is a workspace to hold it, and the
 * name stays INSIDE `_playlists/`.
 *
 * That second check is not `playlistPathOf`'s job done twice. It rejects a `..` SEGMENT, splitting
 * on `/` — which is the whole of the rule on a machine whose separator is `/`, and half of it on
 * Windows, where `..\..\x` is one segment to that function and three to `join`. The file service's
 * `safePath` says the same thing for every path a browser sends; this is the same sentence for a
 * path a command line supplies.
 */
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
