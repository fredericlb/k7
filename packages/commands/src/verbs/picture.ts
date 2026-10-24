// picture.ts — the `picture …` verbs: a song's VIDEO placements, as commands.
//
// Until these existed, a shot could only be moved by dragging it, and `apps/k7/frontend/docs/
// picture.md` recorded the consequences: no context menu on a picture lane, nothing in the
// palette, no CLI, and no entry in the undo journal. Sound had `event move` and picture had a
// mouse. See docs/picture.md for the three that mirror the three drags.

import { join } from "node:path";
import type { K7Path } from "@studio/k7x/ast";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { laneFolder } from "@studio/song/chainItemEdit";
import {
  createPictureLaneFile,
  loadLanes,
  loadProjectRoot,
  loadVideoTracks,
  setLaneOrder,
} from "@studio/song/loader";
import { pictureLaneFile, pictureLaneIds } from "@studio/song/pictureLanes";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { entityFiles } from "@studio/song/yaml/moduleIO";
import { wsData, wsEdit, wsText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { setLaneBypass } from "@studio/song-edit/projectEdit";
import { stripDocExt } from "@studio/song-schema/docExt";
import { timelineLaneOf } from "@studio/song-schema/timelineLane";
import {
  orderPosition,
  orderTracks,
  reorderTracks,
} from "@studio/song-schema/trackKind";
import {
  addVideoPlacement,
  listVideoPlacements,
  removeVideoPlacementAt,
  setVideoLaneRect,
  setVideoPlacementFieldAt,
  shiftVideoAnimationAt,
  splitVideoPlacementAt,
  type VideoPlacement,
} from "@studio/song-schema/yaml/videoTrackFile";
import { parseWallClock } from "@studio/song-video/videoProject";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

/** How close two starts have to be to be the same one — the file is written to the millisecond. */
const SAME = 5e-4;

/** A timeline's name, the way `timeline new` makes one — also what keeps a path out of it. */
const ID = /^[A-Za-z0-9_.-]+$/;

/** Where a picture lane's map is: its own file at the root, or a timeline's file at `pictures[i]`. */
export interface PictureLaneAt {
  rel: string;
  abs: string;
  text: string;
  path: K7Path;
  /** The timeline holding it, when it is one of a timeline's (@studio/song docs/timelines.md). */
  timeline?: string;
}

/** The placements a lane holds, in file order — the indices every edit writes by. */
export const placementsOf = (lane: PictureLaneAt): VideoPlacement[] =>
  listVideoPlacements(new K7Document(lane.text).at(lane.path));

/** A timeline's picture lane, `<timeline>><lane>`, or a refusal naming the ones it has. */
function timelinePictureLane(
  tl: { timeline: string; lane: string },
  h: CommandHost,
): PictureLaneAt | null {
  const rel = `timelines/${tl.timeline}.k7x`;
  const abs = join(h.songPath, rel);
  if (!ID.test(tl.timeline) || !wsExists(abs)) {
    h.refuse([`no timeline '${tl.timeline}' — ${rel} does not exist`]);
    return null;
  }
  const pictures = wsData(abs).pictures;
  const names = (Array.isArray(pictures) ? pictures : []).map((p) =>
    String((p as { lane?: unknown })?.lane),
  );
  const at = names.indexOf(tl.lane);
  if (at < 0) {
    h.refuse([
      `timeline '${tl.timeline}' has no picture lane '${tl.lane}'${names.length ? ` — it has ${names.join(", ")}` : ""}`,
    ]);
    return null;
  }
  return {
    rel,
    abs,
    text: wsText(abs),
    path: ["pictures", at],
    timeline: tl.timeline,
  };
}

/** A lane's file, or a refusal naming the lanes there are; a timeline's lane is its map in the timeline's file. */
export function laneFile(lane: string, h: CommandHost): PictureLaneAt | null {
  const tl = timelineLaneOf(lane.trim());
  if (tl) return timelinePictureLane(tl, h);
  const name = stripDocExt(lane.trim());
  // A lane name is one segment, never a way out — and never a path the lookup below would try.
  if (!ID.test(name)) {
    h.refuse([`'${lane}' is not a lane name`]);
    return null;
  }
  const file = pictureLaneFile(h.songPath, name);
  if (!file) {
    const ids = pictureLaneIds(h.songPath);
    h.refuse([
      `no picture lane '${name}'${ids.length ? ` — this song's are ${ids.join(", ")}` : " — this song has none"}`,
    ]);
    return null;
  }
  return {
    rel: file.rel.replace(/^\//, ""),
    abs: file.path,
    text: wsText(file.path),
    path: [],
  };
}

/** `laneFile` for a verb about the LAYER — its frame, its visibility — which a timeline's lane borrows from the song's. */
export function layerFile(
  lane: string,
  h: CommandHost,
  verb: string,
): PictureLaneAt | null {
  const tl = timelineLaneOf(lane.trim());
  if (tl) {
    h.refuse([
      `picture ${verb}: ${lane} draws on the song's picture lane '${tl.lane}' — ${verb} that one`,
    ]);
    return null;
  }
  return laneFile(lane, h);
}

/** A wall-clock argument as seconds, or a refusal in the dialect's own words. */
export function seconds(
  word: string | undefined,
  h: CommandHost,
): number | null {
  const s = word === undefined ? null : parseWallClock(word);
  if (s === null) {
    h.refuse([
      `'${word ?? ""}' is not a time — picture reads seconds (12.5) or m:ss (1:30.5)`,
    ]);
    return null;
  }
  return s;
}

/** The one placement starting at `at`, or a refusal — two there is an ambiguity nothing may guess at. */
function placementAt(
  list: VideoPlacement[],
  at: number,
  rel: string,
  h: CommandHost,
): number | null {
  const hits = list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Math.abs(p.start - at) < SAME);
  if (!hits.length) {
    const starts = list.map((p) => p.start).join(", ");
    h.refuse([
      `nothing starts at ${at}s on ${rel}${starts ? ` — there are shots at ${starts}` : " — it holds no shot"}`,
    ]);
    return null;
  }
  // Two shots on one lane at one instant: the format allows it and no rule picks between them.
  if (hits.length > 1) {
    h.refuse([
      `${hits.length} shots start at ${at}s on ${rel} — move one of them first, they cannot be told apart`,
    ]);
    return null;
  }
  return (hits[0] as { i: number }).i;
}

/** Edit the lane, snapshotting first for the undo journal; an edit answering false writes nothing and is refused with `refusal`. */
export function put(
  lane: { abs: string; path: K7Path },
  edit: (doc: K7Scope) => unknown,
  h: CommandHost,
  verb: string,
  refusal = `picture ${verb}: nothing to change there`,
): boolean {
  let refused = false;
  try {
    h.snapshot?.(lane.abs);
    wsEdit(lane.abs, (doc) => {
      if (edit(doc.at(lane.path)) !== false) return;
      refused = true;
      throw new Error(refusal);
    });
    return true;
  } catch (e) {
    h.refuse([refused ? refusal : `picture ${verb}: ${(e as Error).message}`]);
    return false;
  }
}

/** What every verb but `add` opens: the lane, its placements, and which one the time names. */
export function target(
  a: string,
  h: CommandHost,
  verb: string,
  tail: string,
):
  | (PictureLaneAt & {
      list: VideoPlacement[];
      at: number;
      index: number;
      rest: string[];
    })
  | null {
  const [laneArg, atArg, ...rest] = splitWords(a);
  if (!laneArg || !atArg) {
    h.refuse([`usage: picture ${verb} <lane> <at> ${tail}`.trimEnd()]);
    return null;
  }
  const found = laneFile(laneArg, h);
  if (!found) return null;
  const at = seconds(atArg, h);
  if (at === null) return null;
  const list = placementsOf(found);
  const index = placementAt(list, at, found.rel, h);
  if (index === null) return null;
  return { ...found, list, at, index, rest };
}

/** The SOUND lanes of the rows — what `trackOrder` lists beside the picture lanes. */
function rowLanes(dir: string): string[] {
  return Object.keys(loadLanes(dir));
}

/** `layer-N`, the first free one beside every lane there is — one name space for sound and picture. */
function nextLaneId(h: CommandHost): string {
  const sub = laneFolder(h.songPath);
  const taken = new Set(
    entityFiles(join(h.songPath, sub), sub).map((e) => e.id),
  );
  let n = 1;
  while (taken.has(`layer-${n}`)) n++;
  return `layer-${n}`;
}

export const PICTURE_VERBS: Record<string, SidHandler> = {
  /** `picture lane new [name]` — `track new`'s counterpart, and the only picture verb that MAKES something. */
  "picture.laneNew": async (a, h) => {
    const id = splitWords(a)[0] || nextLaneId(h);
    // `<timeline>><lane>` is a picture lane of that timeline, drawing on the song's of its name.
    const tl = timelineLaneOf(id);
    if (tl) {
      const file = join(h.songPath, "timelines", `${tl.timeline}.k7x`);
      if (!ID.test(tl.timeline) || !wsExists(file))
        return h.refuse([`no timeline '${tl.timeline}'`]);
      if (!ID.test(tl.lane))
        return h.refuse([
          `invalid lane name '${tl.lane}' — letters, digits, '.', '_' and '-' only`,
        ]);
      const data = wsData(file);
      const taken = [data.lanes, data.pictures].flatMap((l) =>
        Array.isArray(l) ? l.map((x) => String(x?.lane)) : [],
      );
      if (taken.includes(tl.lane))
        return h.refuse([
          `timeline '${tl.timeline}' already has a lane '${tl.lane}'`,
        ]);
      h.snapshot?.(file);
      wsEdit(file, (doc) =>
        doc.addIn(["pictures"], { lane: tl.lane, events: [] }),
      );
      h.log([`${tl.timeline}: + picture lane ${tl.lane}`]);
      return h.reload();
    }
    try {
      const written = createPictureLaneFile(h.songPath, id);
      h.log([`+ picture lane ${id} (${written.join(", ")})`]);
    } catch (e) {
      h.refuse([`picture lane new: ${(e as Error).message}`]);
      return;
    }
    return h.reload();
  },

  /** `picture lane order <lane> <position>` — the draw order is the picture rows' order, so reordering is one `trackOrder` write. */
  "picture.laneOrder": async (a, h) => {
    const [laneArg, whereArg] = splitWords(a);
    if (!laneArg || !whereArg) {
      h.refuse([
        "usage: picture lane order <lane> <position|lane>  (e.g. picture lane order pip 1)",
      ]);
      return;
    }
    // The rows as they draw, and the picture lanes among them bottom first — layer 1 is the back.
    const root = loadProjectRoot(h.songPath, true);
    const pictures = pictureLaneIds(h.songPath);
    const rows = orderTracks(
      [...rowLanes(h.songPath), ...pictures],
      (l) => l,
      Array.isArray(root.trackOrder) ? root.trackOrder.map(String) : undefined,
    );
    const layers = rows.filter((l) => pictures.includes(l)).reverse();
    if (!layers.includes(laneArg)) {
      h.refuse([
        `no picture lane '${laneArg}'${layers.length ? ` — this song's are ${layers.join(", ")}, bottom first` : " — this song has none"}`,
      ]);
      return;
    }
    const pos = orderPosition(layers, whereArg);
    if (pos === null) {
      h.refuse([
        `'${whereArg}' is neither a position nor a lane of this song — try a number 1..${layers.length}`,
      ]);
      return;
    }
    // The picture rows' own slots, refilled top first; the sound rows between them do not move.
    const restacked = reorderTracks(layers, laneArg, pos).reverse();
    let k = 0;
    const order = rows.map((l) => (pictures.includes(l) ? restacked[k++] : l));
    try {
      const file = setLaneOrder(h.songPath, "trackOrder", order);
      h.log([
        `${laneArg} is now layer ${Math.min(Math.max(pos, 1), layers.length)} of ${layers.length}, bottom first (${file})`,
      ]);
    } catch (e) {
      h.refuse([`picture lane order: ${(e as Error).message}`]);
      return;
    }
    return h.reload();
  },

  /** `picture mute <lane>` — HIDDEN, there being no sound on a lane: its bypass, as every lane's mute is. */
  "picture.mute": async (a, h) => {
    const lane = splitWords(a)[0];
    if (!lane) {
      h.refuse(["usage: picture mute <lane>"]);
      return;
    }
    const found = layerFile(lane, h, "mute");
    if (!found) return;
    // Read back rather than assumed: a toggle has to start from what the graph says right now.
    const name = stripDocExt(lane.trim());
    const on = loadVideoTracks(h.songPath)[name]?.mute !== true;
    try {
      const file = setLaneBypass(h.songPath, name, on);
      h.log([`${name}: ${on ? "hidden" : "shown"} (${file})`]);
    } catch (e) {
      h.refuse([`picture mute: ${(e as Error).message}`]);
      return;
    }
    return h.reload();
  },

  /** `picture solo <lane>` — `soloed:` at project.k7x's root, the SAME list audio uses (docs/picture.md). */
  "picture.solo": async (a, h) => {
    const lane = splitWords(a)[0];
    if (!lane) {
      h.refuse(["usage: picture solo <lane>"]);
      return;
    }
    if (!layerFile(lane, h, "solo")) return;
    const cur = (loadProjectRoot(h.songPath).soloed ?? []).map(String);
    const on = !cur.includes(lane);
    const next = on ? [...cur, lane] : cur.filter((x) => x !== lane);
    const file = join(h.songPath, "project.k7x");
    try {
      if (next.length) setFileValue(file, ["soloed"], next);
      else deleteFileValue(file, ["soloed"]);
    } catch (e) {
      h.refuse([`picture solo: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${lane}: solo ${on ? "on" : "off"}` +
        (next.length ? ` — soloed: ${next.join(", ")}` : ""),
    ]);
    return h.reload();
  },

  /** `picture rect <lane> <x> <y> <w> <h>` — where in the frame a lane draws; the viewport drag's verb. */
  "picture.rect": async (a, h) => {
    const [laneArg, ...nums] = splitWords(a);
    const [x, y, w, box] = nums.map(Number);
    if (
      !laneArg ||
      nums.length !== 4 ||
      [x, y, w, box].some((n) => !Number.isFinite(n))
    ) {
      h.refuse([
        "usage: picture rect <lane> <x> <y> <w> <h>  (e.g. picture rect pip 960 540 320 180)",
      ]);
      return;
    }
    if (w <= 0 || box <= 0) {
      h.refuse([
        `a lane ${w}x${box} draws nothing — the width and height ARE the frame it fills, in viewport px`,
      ]);
      return;
    }
    const found = layerFile(laneArg, h, "rect");
    if (!found) return;
    const rect = { x, y, w, h: box };
    if (!put(found, (doc) => setVideoLaneRect(doc, rect), h, "rect")) return;
    h.log([`${found.rel}: ${w}x${box} at ${x},${y}`]);
    return h.reload();
  },

  /** `picture move <lane> <at> <to>` — the body drag: `start`, and nothing else. */
  "picture.move": (a, h) => {
    const t = target(a, h, "move", "<to>");
    if (!t) return;
    const to = seconds(t.rest[0], h);
    if (to === null) return;
    const shot = t.list[t.index] as VideoPlacement;
    const move = (doc: K7Scope) => {
      setVideoPlacementFieldAt(doc, t.index, "start", to);
    };
    if (!put(t, move, h, "move")) return;
    h.log([`${t.rel}: ${shot.ref} ${t.at}s → ${to}s`]);
    return h.reload();
  },

  /** `picture length <lane> <at> <seconds>` — the right-edge drag: the extent, 0 meaning "to the end of the source". */
  "picture.length": (a, h) => {
    const t = target(a, h, "length", "<seconds>");
    if (!t) return;
    const len = seconds(t.rest[0], h);
    if (len === null) return;
    const shot = t.list[t.index] as VideoPlacement;
    const extent = (doc: K7Scope) => {
      setVideoPlacementFieldAt(doc, t.index, "length", len);
    };
    if (!put(t, extent, h, "length")) return;
    h.log([
      `${t.rel}: ${shot.ref} lasts ${len ? `${len}s` : "to the end of its source"}`,
    ]);
    return h.reload();
  },

  /** `picture head <lane> <at> <to>` — the left-edge drag, and the only one that writes THREE fields. */
  "picture.head": (a, h) => {
    const t = target(a, h, "head", "<to>");
    if (!t) return;
    const to = seconds(t.rest[0], h);
    if (to === null) return;
    const shot = t.list[t.index] as VideoPlacement;
    const delta = to - shot.start;
    if (Math.abs(delta) < SAME)
      return h.log([`${t.rel}: ${shot.ref} unchanged`]);
    // The in-point moves by the delta AT THE SHOT'S SPEED, which is what keeps the frame under the edge.
    const speed = shot.speed ?? 1;
    const from = shot.sourceFrom + delta * speed;
    // The head cannot walk back past the source's own first frame.
    if (from < -SAME) {
      h.refuse([
        `${shot.ref} starts ${shot.sourceFrom}s into its source, so the head cannot move back more than that`,
      ]);
      return;
    }
    // A length-0 shot has no measured extent here, so pinning one would invent a number the compiler owns.
    if (shot.length > 0 && shot.length - delta <= SAME) {
      h.refuse([
        `that would leave ${shot.ref} ${Math.round((shot.length - delta) * 1000)}ms long — trim the tail instead`,
      ]);
      return;
    }
    // Three fields, together: from follows the head or the frame changes, and length the other way or the TAIL slides.
    const head = (doc: K7Scope) => {
      setVideoPlacementFieldAt(doc, t.index, "start", to);
      setVideoPlacementFieldAt(doc, t.index, "from", from);
      if (shot.length > 0)
        setVideoPlacementFieldAt(doc, t.index, "length", shot.length - delta);
      // …and the keys by the same delta, so an animation stays on the frames it was set on (song-video docs/animation.md).
      shiftVideoAnimationAt(doc, t.index, delta);
    };
    if (!put(t, head, h, "head")) return;
    h.log([
      `${t.rel}: ${shot.ref} head ${t.at}s → ${to}s` +
        (shot.length > 0 ? ", tail held" : ", length still the source's"),
    ]);
    return h.reload();
  },

  /** `picture delete <lane> <at>` — the placement goes; the clip it names does not. */
  "picture.delete": (a, h) => {
    const t = target(a, h, "delete", "");
    if (!t) return;
    const shot = t.list[t.index] as VideoPlacement;
    const drop = (doc: K7Scope) => {
      removeVideoPlacementAt(doc, t.index);
    };
    if (!put(t, drop, h, "delete")) return;
    h.log([
      `${t.rel}: − ${shot.ref} at ${t.at}s (the clip stays; a lane holds placements)`,
    ]);
    return h.reload();
  },

  /** `picture split <lane> <at> <where>` — two placements of one clip, and nothing rendered (docs/picture.md). */
  "picture.split": (a, h) => {
    const t = target(a, h, "split", "<where>");
    if (!t) return;
    const where = seconds(t.rest[0] ?? "", h);
    if (where === null) return;
    const shot = t.list[t.index] as VideoPlacement;
    const split = (doc: K7Scope) => splitVideoPlacementAt(doc, t.index, where);
    const outside = `${t.rel}: ${where}s is not inside the shot at ${t.at}s`;
    if (!put(t, split, h, "split", outside)) return;
    h.log([
      `${t.rel}: ${shot.ref || "activation"} at ${t.at}s split at ${where}s`,
    ]);
    return h.reload();
  },

  /** `picture add <lane> <ref> <at> [length] [sourceFrom]` — a shot on a lane, the clip already existing. */
  "picture.add": (a, h) => {
    const [laneArg, ref, atArg, lenArg, fromArg] = splitWords(a);
    if (!laneArg || !ref || !atArg) {
      h.refuse([
        "usage: picture add <lane> <ref> <at> [length] [sourceFrom]  (e.g. picture add main shot_a 12.5 4)",
      ]);
      return;
    }
    const found = laneFile(laneArg, h);
    if (!found) return;
    const at = seconds(atArg, h);
    if (at === null) return;
    // Length is optional and 0 is its meaning-bearing default: run to the end of the source.
    const length = lenArg === undefined ? 0 : seconds(lenArg, h);
    if (length === null) return;
    const sourceFrom = fromArg === undefined ? 0 : seconds(fromArg, h);
    if (sourceFrom === null) return;
    // The ref names a `clips/` entry, and only the compiler reads those — so this reports rather than refuses.
    const clip = join(h.songPath, "clips", `${ref}.k7x`);
    const unknown = !wsExists(clip);
    const shot = { ref, start: at, length, sourceFrom };
    const add = (doc: K7Scope) => addVideoPlacement(doc, shot);
    const shape = `${found.rel}: the way \`events\` is written there is not a shape this can extend — add the line by hand`;
    if (!put(found, add, h, "add", shape)) return;
    h.log([
      `${found.rel}: + ${ref} at ${at}s${length ? ` for ${length}s` : ""}`,
      ...(unknown
        ? [`no clips/${ref}.k7x — the lane will report it until there is one`]
        : []),
    ]);
    return h.reload();
  },
};
