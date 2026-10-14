// picture.ts — the `picture …` verbs: a song's VIDEO placements, as commands.
//
// Until these existed, a shot could only be moved by dragging it, and `apps/k7/frontend/docs/
// picture.md` recorded the consequences: no context menu on a picture lane, nothing in the
// palette, no CLI, and no entry in the undo journal. Sound had `event move` and picture had a
// mouse. See docs/picture.md for the three that mirror the three drags.

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createVideoTrackFile,
  loadProjectRoot,
  setLaneOrder,
} from "@studio/song/loader";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { wsExists, wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import { orderPosition, reorderTracks } from "@studio/song-schema/trackKind";
import {
  addVideoPlacement,
  listVideoPlacements,
  removeVideoPlacementAt,
  setVideoLaneMute,
  setVideoLaneRect,
  setVideoPlacementFieldAt,
  type VideoPlacement,
} from "@studio/song-schema/yaml/videoTrackFile";
import { parseWallClock } from "@studio/song-video/videoProject";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

/** Where a song keeps its picture lanes — one file per lane, `packages/song-video/docs/picture.md`. */
const LANES_DIR = "video_tracks";

/** How close two starts have to be to be the same one — the file is written to the millisecond. */
const SAME = 5e-4;

/** A lane's file, or a refusal naming the lanes there are. */
function laneFile(
  lane: string,
  h: CommandHost,
): { rel: string; abs: string; text: string } | null {
  const name = lane.trim().replace(/\.(ya?ml|k7x)$/i, "");
  const dir = resolve(h.songPath, LANES_DIR);
  const abs = join(dir, `${name}.yaml`);
  // Containment, as every path-taking verb does: a lane name is one segment, never a way out.
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    !abs.startsWith(dir)
  ) {
    h.refuse([`'${lane}' is not a lane name`]);
    return null;
  }
  if (!wsExists(abs)) {
    h.refuse([
      `no picture lane '${name}' — this song's lanes are in ${LANES_DIR}/`,
    ]);
    return null;
  }
  return {
    rel: `${LANES_DIR}/${name}.yaml`,
    abs,
    text: wsRead(abs),
  };
}

/** A wall-clock argument as seconds, or a refusal in the dialect's own words. */
function seconds(word: string | undefined, h: CommandHost): number | null {
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

/** Write the lane, snapshotting first so the undo journal has the before — every picture verb ends here. */
function put(abs: string, next: string, h: CommandHost, verb: string): boolean {
  try {
    h.snapshot?.(abs);
    wsWrite(abs, next);
    return true;
  } catch (e) {
    h.refuse([`picture ${verb}: ${(e as Error).message}`]);
    return false;
  }
}

/** What every verb but `add` opens: the lane, its placements, and which one the time names. */
function target(
  a: string,
  h: CommandHost,
  verb: string,
  tail: string,
): {
  rel: string;
  abs: string;
  text: string;
  list: VideoPlacement[];
  at: number;
  index: number;
  rest: string[];
} | null {
  const [laneArg, atArg, ...rest] = splitWords(a);
  if (!laneArg || !atArg) {
    h.refuse([`usage: picture ${verb} <lane> <at> ${tail}`.trimEnd()]);
    return null;
  }
  const found = laneFile(laneArg, h);
  if (!found) return null;
  const at = seconds(atArg, h);
  if (at === null) return null;
  const list = listVideoPlacements(found.text);
  const index = placementAt(list, at, found.rel, h);
  if (index === null) return null;
  return { ...found, list, at, index, rest };
}

/** `layer-N`, the first free one — the lanes are a DIRECTORY, not something the song's own doc holds. */
function nextLaneId(h: CommandHost): string {
  const dir = resolve(h.songPath, LANES_DIR);
  const taken = new Set(
    wsExists(dir)
      ? readdirSync(dir).map((f) => f.replace(/\.(ya?ml|k7x)$/i, ""))
      : [],
  );
  let n = 1;
  while (taken.has(`layer-${n}`)) n++;
  return `layer-${n}`;
}

export const PICTURE_VERBS: Record<string, SidHandler> = {
  /** `picture lane new [name]` — `track new`'s counterpart, and the only picture verb that MAKES something. */
  "picture.laneNew": async (a, h) => {
    const id = splitWords(a)[0] || nextLaneId(h);
    try {
      const written = createVideoTrackFile(h.songPath, id);
      h.log([`+ picture lane ${id} (${written.join(", ")})`]);
    } catch (e) {
      h.refuse([`picture lane new: ${(e as Error).message}`]);
      return;
    }
    return h.reload();
  },

  /** `picture lane order <lane> <position>` — `layers` IS the draw order, so reordering is one list write. */
  "picture.laneOrder": async (a, h) => {
    const [laneArg, whereArg] = splitWords(a);
    if (!laneArg || !whereArg) {
      h.refuse([
        "usage: picture lane order <lane> <position|lane>  (e.g. picture lane order pip 1)",
      ]);
      return;
    }
    const stated = loadProjectRoot(h.songPath, true).project?.layers;
    const layers = Array.isArray(stated) ? stated.map(String) : [];
    if (!layers.includes(laneArg)) {
      h.refuse([
        `no picture lane '${laneArg}'${layers.length ? ` — project.layers names ${layers.join(", ")}` : " — this song lists none"}`,
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
    try {
      const file = setLaneOrder(
        h.songPath,
        "layers",
        reorderTracks(layers, laneArg, pos),
      );
      h.log([
        `${laneArg} is now layer ${Math.min(Math.max(pos, 1), layers.length)} of ${layers.length}, bottom first (${file})`,
      ]);
    } catch (e) {
      h.refuse([`picture lane order: ${(e as Error).message}`]);
      return;
    }
    return h.reload();
  },

  /** `picture mute <lane>` — HIDDEN, there being no sound on a lane; the lane's own file carries it. */
  "picture.mute": async (a, h) => {
    const lane = splitWords(a)[0];
    if (!lane) {
      h.refuse(["usage: picture mute <lane>"]);
      return;
    }
    const found = laneFile(lane, h);
    if (!found) return;
    // Read back rather than assumed: a toggle has to start from what the file says right now.
    const on = !/^mute:\s*true\b/m.test(found.text);
    if (!put(found.abs, setVideoLaneMute(found.text, on), h, "mute")) return;
    h.log([`${found.rel}: ${on ? "hidden" : "shown"}`]);
    return h.reload();
  },

  /** `picture solo <lane>` — `soloed:` at project.yaml's root, the SAME list audio uses (docs/picture.md). */
  "picture.solo": async (a, h) => {
    const lane = splitWords(a)[0];
    if (!lane) {
      h.refuse(["usage: picture solo <lane>"]);
      return;
    }
    if (!laneFile(lane, h)) return;
    const cur = (loadProjectRoot(h.songPath).soloed ?? []).map(String);
    const on = !cur.includes(lane);
    const next = on ? [...cur, lane] : cur.filter((x) => x !== lane);
    const file = join(h.songPath, "project.yaml");
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
    const found = laneFile(laneArg, h);
    if (!found) return;
    const next = setVideoLaneRect(found.text, { x, y, w, h: box });
    if (!put(found.abs, next, h, "rect")) return;
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
    const next = setVideoPlacementFieldAt(t.text, t.index, "start", to);
    if (!put(t.abs, next, h, "move")) return;
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
    const next = setVideoPlacementFieldAt(t.text, t.index, "length", len);
    if (!put(t.abs, next, h, "length")) return;
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
    // The head cannot walk back past the source's own first frame.
    if (shot.sourceFrom + delta < -SAME) {
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
    // Three fields, together: source_from follows the head or the frame changes, and length the other way or the TAIL slides.
    let next = setVideoPlacementFieldAt(t.text, t.index, "start", to);
    next = setVideoPlacementFieldAt(
      next,
      t.index,
      "source_from",
      shot.sourceFrom + delta,
    );
    if (shot.length > 0)
      next = setVideoPlacementFieldAt(
        next,
        t.index,
        "length",
        shot.length - delta,
      );
    if (!put(t.abs, next, h, "head")) return;
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
    const next = removeVideoPlacementAt(t.text, t.index);
    if (!put(t.abs, next, h, "delete")) return;
    h.log([
      `${t.rel}: − ${shot.ref} at ${t.at}s (the clip stays; a lane holds placements)`,
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
    const clip = resolve(h.songPath, "clips", `${ref}.yaml`);
    const unknown = !wsExists(clip);
    const next = addVideoPlacement(found.text, {
      ref,
      start: at,
      length,
      sourceFrom,
    });
    if (next === null) {
      h.refuse([
        `${found.rel}: the way \`events:\` is written there is not a shape this can extend — add the line by hand`,
      ]);
      return;
    }
    if (!put(found.abs, next, h, "add")) return;
    h.log([
      `${found.rel}: + ${ref} at ${at}s${length ? ` for ${length}s` : ""}`,
      ...(unknown
        ? [`no clips/${ref}.yaml — the lane will report it until there is one`]
        : []),
    ]);
    return h.reload();
  },
};
