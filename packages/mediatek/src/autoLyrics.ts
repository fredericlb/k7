// autoLyrics.ts — the library's side of looking a song's lyrics up unattended: whether a song is due
// for a lookup, and what a lookup leaves behind. A miss is written in the sidecar's `lyricsSearch:`
// and keeps the song from being asked again for a week. The lookup itself is the caller's, over
// the network — docs/autoLyrics.md.

import { existsSync } from "node:fs";
import { writablePath } from "./layout.ts";
import {
  createSongbook,
  setFactsAt,
  sidecarDoc,
  writeSidecar,
  writeTextsAt,
} from "./songbook.ts";
import { readDuration, readMasterTags } from "./tags.ts";
import { K7_ARTIST, LYRICS_FILE } from "./types.ts";
import { existingMaster, familyOf } from "./write.ts";

/** How long a lookup that found nothing keeps a song from being looked up again. */
export const LYRICS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Why a lookup left no lyrics: nothing sure enough found, the service unreachable, no title to ask with. */
export type LyricsMiss = "not-found" | "error" | "no-title";

/** What a lookup needs to ask: the song's names and the master's length. */
export interface LyricsQuery {
  folder: string;
  artist: string;
  title: string;
  duration?: number;
}

/** The sidecar's mark of the last lookup that left no lyrics, or null. */
function lastMiss(rel: string): { at: number; result: string } | null {
  const data = sidecarDoc(rel).toJS() as Record<string, unknown> | null;
  const v = data?.lyricsSearch as { at?: string; result?: string } | undefined;
  const at = Date.parse(v?.at ?? "");
  return Number.isFinite(at) ? { at, result: v?.result ?? "" } : null;
}

/** The query for a song due a lookup, or null: a master and no lyrics, never a K7 release, never within a week of a miss. */
export async function lyricsQuery(
  folder: string,
  now = Date.now(),
): Promise<LyricsQuery | null> {
  const rel = folder.replace(/^\/+|\/+$/g, "");
  const parts = rel.split("/");
  if (familyOf(rel) !== "songs" || parts[1] === K7_ARTIST) return null;
  const master = existingMaster(writablePath(rel));
  if (!master || existsSync(writablePath(`${rel}/${LYRICS_FILE}`))) return null;
  const miss = lastMiss(rel);
  // An instrumental is an answer, not a miss: there is nothing to look for again.
  if (miss?.result === "instrumental") return null;
  if (miss && now - miss.at < LYRICS_RETRY_MS) return null;
  const abs = writablePath(`${rel}/${master}`);
  const tags = await readMasterTags(abs);
  return {
    folder: rel,
    artist: tags.artist ?? "",
    title: tags.title ?? "",
    duration: await readDuration(abs),
  };
}

/** Write down a lookup that left no lyrics, so the next one waits a week — or, for an instrumental, never comes. */
export function recordLyricsMiss(
  folder: string,
  result: LyricsMiss | "instrumental",
  now = Date.now(),
): void {
  const doc = sidecarDoc(folder);
  doc.set("lyricsSearch", { at: new Date(now).toISOString(), result });
  writeSidecar(folder, doc);
  if (result === "instrumental")
    setFactsAt(folder, { lyricsMatch: "instrumental" });
}

/** Keep what a lookup found: the lyrics beside the master, which makes the song a songbook song. */
export function recordFoundLyrics(
  query: LyricsQuery,
  found: { lyrics: string; timed: boolean },
): void {
  const doc = sidecarDoc(query.folder);
  if (!doc.get("uuid"))
    createSongbook({
      folder: query.folder,
      artist: query.artist,
      title: query.title,
      owner: "",
    });
  writeTextsAt(query.folder, { lyrics: found.lyrics });
  const after = sidecarDoc(query.folder);
  after.delete("lyricsSearch");
  writeSidecar(query.folder, after);
  if (found.timed) setFactsAt(query.folder, { lyricsMatch: "matched" });
}
