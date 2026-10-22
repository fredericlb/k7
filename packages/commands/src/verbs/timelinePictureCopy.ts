// timelinePictureCopy.ts — `timeline lane copy` for a PICTURE lane: its shots onto a new picture lane
// of a timeline, or of the song. What a reader gets wrong: the shots are copied in seconds, as written,
// and a timeline's picture lane has no frame of its own — it draws on the song's lane of its name.
// See @studio/song docs/timelines.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { createVideoTrackFile } from "@studio/song/loader";
import { wsData, wsEdit } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { stripDocExt } from "@studio/song-schema/docExt";
import { splitPort } from "@studio/song-schema/moduleTypes";
import { SONG_TARGET, timelineLaneOf } from "@studio/song-schema/timelineLane";
import type { CommandHost } from "../commands.ts";
import { laneFile } from "./picture.ts";

const NAME = /^[A-Za-z0-9_.-]+$/;

/** The song's own frame and colour, which a copy within the song keeps; a timeline's lane has neither. */
const LAYER_KEYS = ["color", "x", "y", "w", "h"] as const;

/** `base`, or `base-2`, `base-3`… — the first that `taken` does not hold. */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Whether `lane` names a picture lane — the song's, or a timeline's — without refusing anything. */
export function isPictureLane(h: CommandHost, lane: string): boolean {
  const tl = timelineLaneOf(lane);
  if (!tl)
    return (
      NAME.test(lane) &&
      wsExists(join(h.songPath, "video_tracks", `${lane}.k7x`))
    );
  const file = join(h.songPath, "timelines", `${tl.timeline}.k7x`);
  if (!NAME.test(tl.timeline) || !wsExists(file)) return false;
  const pictures = wsData(file).pictures;
  return (
    Array.isArray(pictures) &&
    pictures.some((p) => (p as { lane?: unknown })?.lane === tl.lane)
  );
}

/** Copy picture lane `laneArg` to timeline `to`, or to the song when `to` is `main`. */
export async function copyPictureLane(
  h: CommandHost,
  laneArg: string,
  to: string,
  name: string | undefined,
): Promise<void> {
  const from = laneFile(laneArg, h);
  if (!from) return;
  const map = (new K7Document(from.text).at(from.path).toJS() ?? {}) as Record<
    string,
    unknown
  >;
  const events = Array.isArray(map.events) ? map.events : [];
  const label = timelineLaneOf(laneArg)?.lane ?? laneArg;

  if (to === SONG_TARGET) {
    const dir = join(h.songPath, "video_tracks");
    // Song lanes and picture lanes share one name space, the graph drawing both.
    const taken = new Set([
      ...h.project().tracks.map((t) => splitPort(t.id).node),
      ...(wsExists(dir) ? readdirSync(dir).map(stripDocExt) : []),
    ]);
    const id = name ?? freeName(label, taken);
    // The song's lane keeps its frame when it is copied within the song; a timeline's has none to give.
    const keep = from.timeline
      ? {}
      : Object.fromEntries(
          LAYER_KEYS.filter((k) => map[k] !== undefined).map((k) => [
            k,
            map[k],
          ]),
        );
    try {
      const written = createVideoTrackFile(h.songPath, id);
      wsEdit(join(h.songPath, "video_tracks", `${id}.k7x`), (doc) => {
        for (const [k, v] of Object.entries(keep)) doc.setIn([k], v);
        if (events.length) doc.setIn(["events"], events);
      });
      h.log([
        `+ picture lane ${id}: ${events.length} shot(s) of ${laneArg} (${written.join(", ")})`,
      ]);
    } catch (e) {
      return h.refuse([`timeline lane copy failed: ${(e as Error).message}`]);
    }
    return h.reload();
  }

  const file = join(h.songPath, "timelines", `${to}.k7x`);
  if (!NAME.test(to) || !wsExists(file))
    return h.refuse([
      `no timeline "${to}" — name a timeline of timelines/, or ${SONG_TARGET} for the main one`,
    ]);
  const data = wsData(file);
  const taken = new Set(
    [data.lanes, data.pictures].flatMap((l) =>
      Array.isArray(l) ? l.map((x) => String(x?.lane)) : [],
    ),
  );
  const id = name ?? freeName(label, taken);
  if (!NAME.test(id) || taken.has(id))
    return h.refuse([
      `'${id}' cannot name a new lane of '${to}' — taken, or not a name`,
    ]);
  h.snapshot?.(file);
  wsEdit(file, (doc) => doc.addIn(["pictures"], { lane: id, events }));
  h.log([
    `${to}: + picture lane ${id}, ${events.length} shot(s) of ${laneArg} — it draws on the song's picture lane '${id}'`,
  ]);
  return h.reload();
}
