// queueRows.ts — what a row's "add to queue" takes: the song, or an album's songs in track order. Pure, so it is
// tested without a screen. What a reader would get wrong: a song only the server holds is queued only while it
// streams from there (`base`), or the queue would hold a row playback skips in silence. See ../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import type { MediatekEntry } from "@studio/mediatek/types";
import { relative } from "./libraryTree";

const hasMaster = (e: MediatekEntry): boolean =>
  !!takesOf(e).find((k) => k.kind === "master")?.file;

/** Track number first, then the title, so an untagged album still comes in a stable order. */
const trackOrder = (a: MediatekEntry, b: MediatekEntry) => {
  const ta = typeof a.meta?.track === "number" ? a.meta.track : Infinity;
  const tb = typeof b.meta?.track === "number" ? b.meta.track : Infinity;
  return ta === tb ? a.name.localeCompare(b.name) : ta - tb;
};

/** The songs `rel` (family-relative) queues: itself when it is a song, else those directly in it, an album's. */
export function queueable(
  known: MediatekEntry[],
  rel: string,
  baseOf: (e: MediatekEntry) => string | undefined,
  base: string | undefined,
): MediatekEntry[] {
  if (!rel) return [];
  // A server-only song plays only while the server's stream is known.
  const playable = (e: MediatekEntry) => hasMaster(e) && (!!base || !baseOf(e));
  const self = known.find((e) => relative(e.path) === rel);
  if (self) return playable(self) ? [self] : [];
  return known
    .filter((e) => {
      const r = relative(e.path);
      return r.startsWith(`${rel}/`) && !r.slice(rel.length + 1).includes("/");
    })
    .filter(playable)
    .sort(trackOrder);
}
