// timelinePictures.ts — the shots a placed timeline puts in the PICTURE: each of its `pictures:`
// lanes lands on the song's picture lane of the same name, at the second the timeline plays, cut at
// its end. What a reader gets wrong: the host is found by NAME, not by the lane the timeline is
// placed on — that one is a sound lane, with no frame. See docs/timelines.md.

import { parseDuration, startBeats } from "@studio/song-schema/timecode";
import { placementToClip } from "./compile/clips";
import {
  type RawTimeline,
  type TimelineCtx,
  timelineLength,
} from "./compile/timelines";
import { projectRoots } from "./confine";
import {
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  readYamlEntities,
} from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import type {
  RawClip,
  RawPlacement,
  RawSequence,
  RawVideoPlacement,
  RawVideoTrack,
} from "./rawDoc";
import { lanesOf } from "./trackModule";

export type { RawTimeline };

/** Placed shots by picture lane name, in song seconds, each with an explicit length. */
export type PlacedShots = Map<string, RawVideoPlacement[]>;

/** One lane's shots moved `from` seconds on and cut at `end`; a shot with no length gets the one the picture would give it. */
function placeShots(
  timeline: string,
  shots: readonly RawVideoPlacement[],
  from: number,
  end: number,
): RawVideoPlacement[] {
  return shots.flatMap((s, i) => {
    const own = Number(s.start ?? 0);
    const start = from + own;
    const room = end - start;
    if (room <= 1e-6) return [];
    // The picture's rule: a length, else the next entry's start, else open — open being the timeline's end here.
    const next = shots[i + 1];
    const stated = Number(s.length ?? 0);
    const length =
      stated > 0 ? stated : next ? Number(next.start ?? 0) - own : room;
    if (!(length > 0)) return [];
    return [{ ...s, start, length: Math.min(length, room), timeline }];
  });
}

/** Every shot the timelines among `events` place, by picture lane name — recursively, each cut at its timeline's end. */
export function timelineShots(
  events: readonly RawPlacement[],
  ctx: TimelineCtx,
  out: PlacedShots = new Map(),
  within?: { offset: number; end: number },
  seen: readonly string[] = [],
): PlacedShots {
  for (const p of events) {
    const ref = String(p?.ref ?? "");
    const t = ctx.timelines[ref];
    // A cycle is checkReferences' to report; a disabled event shows nothing, as it plays nothing.
    if (!t || p.disabled || seen.includes(ref)) continue;
    const start = (within?.offset ?? 0) + ctx.pos(p.start);
    const end = Math.min(
      start + timelineLength(ref, ctx),
      within?.end ?? Number.POSITIVE_INFINITY,
    );
    for (const lane of t.pictures ?? []) {
      if (lane.disabled) continue;
      const shots = placeShots(
        ref,
        (lane.events ?? []) as RawVideoPlacement[],
        start / ctx.beatsPerSec,
        end / ctx.beatsPerSec,
      );
      if (shots.length)
        out.set(lane.lane, [...(out.get(lane.lane) ?? []), ...shots]);
    }
    for (const lane of t.lanes)
      if (!lane.disabled)
        timelineShots(lane.events ?? [], ctx, out, { offset: start, end }, [
          ...seen,
          ref,
        ]);
  }
  return out;
}

/** The song's picture lanes with the placed shots put FIRST, so a lane's own shot with no length still runs to its own next one. */
export function withTimelineShots(
  lanes: Record<string, RawVideoTrack>,
  placed: PlacedShots,
): Record<string, RawVideoTrack> {
  const out = { ...lanes };
  for (const [id, shots] of placed)
    if (out[id])
      out[id] = {
        ...out[id],
        events: [...shots, ...(out[id].events ?? [])],
      };
  return out;
}

/** The project's timelines, and the shots those placed on its lanes put in the picture — what the picture compile reads. */
export function loadTimelinePictures(dir: string): {
  timelines: Record<string, RawTimeline>;
  placed: PlacedShots;
} {
  const timelines = readYamlEntities(dir, "timelines").values as Record<
    string,
    RawTimeline
  >;
  if (!Object.values(timelines).some((t) => t.pictures?.length))
    return { timelines, placed: new Map() };
  const proj = loadProjectRoot(dir).project ?? {};
  const tempo = Number(proj.tempo ?? 120);
  const [num, den] = String(proj.timeSignature ?? "4/4")
    .split("/")
    .map((n) => parseInt(n, 10));
  if (!num || !den) return { timelines, placed: new Map() };
  const clipsMap = readYamlEntities(dir, "clips").values as Record<
    string,
    RawClip
  >;
  const seqMap = readYamlEntities(dir, "sequences").values as Record<
    string,
    RawSequence
  >;
  const roots = projectRoots(dir);
  // The same context the song compile builds, so a timeline is exactly as long in the picture as in the sound.
  const ctx: TimelineCtx = {
    timelines,
    pos: (tc) => startBeats(tc, num, den, tempo),
    dur: (tc) =>
      tc != null && tc !== "" ? parseDuration(String(tc), num, den) : 0,
    bar: (num * 4) / den,
    beatsPerSec: tempo / 60,
    clipOf: (p) =>
      placementToClip(dir, p, clipsMap, seqMap, num, den, tempo, roots),
  };
  const lanes = lanesOf(
    resolveModuleMap(loadModules(dir), loadModuleRefs(dir)),
  );
  const placed: PlacedShots = new Map();
  for (const lane of Object.values(lanes))
    if (lane.type !== "group" && !lane.disabled)
      timelineShots(lane.events, ctx, placed);
  return { timelines, placed };
}
