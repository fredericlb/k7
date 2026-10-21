// compile/timelines.ts — a TIMELINE placed as one event, expanded into the events it holds: each
// shifted to where the timeline plays, cut at its fixed end, and tagged with the event the surfaces
// draw. What a reader gets wrong: the expansion happens BEFORE an event is routed to a half, so a
// timeline mixing clips and sequences feeds both of its lane's outputs. See docs/timelines.md.

import { placementId } from "@studio/song-schema/placementId";
import {
  FIXED_FIELDS,
  NEST_SEP,
  timelineLaneId,
} from "@studio/song-schema/timelineLane";
import type { TimelineFile } from "@studio/song-schema/yaml/timelineSchema";
import type {
  ClipDoc,
  EventDoc,
  NestDoc,
  TimelineDoc,
  TimelineLaneDoc,
  TrackDoc,
} from "../project";
import type { RawPlacement } from "../rawDoc";

export type RawTimeline = TimelineFile;

/** The fields `p` carries that a timeline event may not. */
export const fixedFieldsOf = (p: RawPlacement): string[] =>
  FIXED_FIELDS.filter((k) => p[k] !== undefined);

/** Where an expanded event plays: what the timeline events around it add up to. */
export interface Within {
  offset: number; // beats added to its clips' start
  end: number; // the beat past which nothing of it plays
  gain: number; // dB, the timeline events' own trims summed
  disabled: boolean;
  prefix: string; // its clips' id prefix, one `<ref>@<start>>` per timeline it sits in
  nest: NestDoc; // the outermost timeline event, the one its lane draws
}

/** An event of a lane once its timelines are expanded: as written, and where it plays. */
export interface Leaf {
  p: RawPlacement;
  within?: Within;
}

export interface TimelineCtx {
  timelines: Record<string, RawTimeline>;
  pos: (tc: unknown) => number; // a 1-based position, in beats
  dur: (tc: unknown) => number; // a 0-based duration, in beats
  bar: number; // beats in a bar
  clipOf: (p: RawPlacement) => ClipDoc; // an ordinary event, compiled
  lengths?: Map<string, number>;
}

/** A timeline's fixed length in beats: its `length`, else its content's end rounded up to the bar. */
export function timelineLength(
  id: string,
  ctx: TimelineCtx,
  seen: readonly string[] = [],
): number {
  if (!ctx.lengths) ctx.lengths = new Map();
  const memo = ctx.lengths;
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  const t = ctx.timelines[id];
  // A cycle has no length; checkReferences is what reports it.
  if (!t || seen.includes(id)) return 0;
  let len: number;
  if (t.length) len = Math.max(0, ctx.dur(t.length));
  else {
    let end = 0;
    for (const lane of t.lanes)
      for (const p of lane.events ?? []) {
        const ref = String(p.ref ?? "");
        const extent = ctx.timelines[ref]
          ? timelineLength(ref, ctx, [...seen, id])
          : ctx.clipOf(p).length;
        end = Math.max(end, ctx.pos(p.start) + extent);
      }
    len = Math.max(1, Math.ceil(end / ctx.bar - 1e-9)) * ctx.bar;
  }
  memo.set(id, len);
  return len;
}

/** `events` with every timeline event replaced by the events it holds, recursively. */
export function expandEvents(
  events: readonly RawPlacement[],
  ctx: TimelineCtx,
  within?: Within,
  seen: readonly string[] = [],
): Leaf[] {
  const out: Leaf[] = [];
  for (const p of events) {
    const ref = String(p?.ref ?? "");
    const t = ctx.timelines[ref];
    if (!t) {
      out.push(within ? { p, within } : { p });
      continue;
    }
    if (seen.includes(ref)) continue; // a cycle, reported by checkReferences
    const at = ctx.pos(p.start);
    const start = (within?.offset ?? 0) + at;
    const length = timelineLength(ref, ctx);
    const gain = Number(p.gain ?? 0) || 0;
    const event: EventDoc = {
      ...(gain ? { gain } : {}),
      ...(p.disabled ? { disabled: true } : {}),
    };
    const inner: Within = {
      offset: start,
      end: Math.min(start + length, within?.end ?? Number.POSITIVE_INFINITY),
      gain: (within?.gain ?? 0) + gain,
      disabled: !!within?.disabled || !!p.disabled,
      prefix: `${within?.prefix ?? ""}${placementId(ref, at)}${NEST_SEP}`,
      nest: within?.nest ?? {
        of: placementId(ref, start),
        ref,
        start,
        length,
        ...(Object.keys(event).length ? { event } : {}),
      },
    };
    for (const lane of t.lanes)
      out.push(
        ...expandEvents(
          lane.events ?? [],
          ctx,
          lane.disabled ? { ...inner, disabled: true } : inner,
          [...seen, ref],
        ),
      );
  }
  return out;
}

/** An expanded event's clips moved to where its timeline plays, and cut at its end. */
export function placeWithin(clips: ClipDoc[], w: Within): ClipDoc[] {
  return clips.flatMap((c): ClipDoc[] => {
    const start = c.start + w.offset;
    const room = w.end - start;
    if (room <= 1e-9) return [];
    // A length of 0 is the source's own, which only the engine knows: the room left is an upper bound it clamps.
    const length = c.length > 0 ? Math.min(c.length, room) : room;
    const db = c.type === "audio" ? (c.gainDb ?? 0) + w.gain : 0;
    const { gainDb: _g, ...rest } = c;
    const gainDb = Math.max(-6, Math.min(6, db));
    return [
      {
        ...rest,
        id: w.prefix + c.id,
        start,
        length,
        fadeOut: Math.min(c.fadeOut, length),
        ...(gainDb ? { gainDb } : {}),
        ...(w.disabled ? { disabled: true } : {}),
        ...(c.comp ? { comp: { ...c.comp, of: w.prefix + c.comp.of } } : {}),
        nest: w.nest,
      },
    ];
  });
}

/** Every timeline of the project, compiled for the view that edits it: its lanes, its events at its own positions. */
export function timelineDocs(
  ctx: TimelineCtx,
  place: (leaf: Leaf) => ClipDoc[],
): TimelineDoc[] {
  return Object.entries(ctx.timelines).map(([id, t]) => ({
    id,
    length: timelineLength(id, ctx),
    lanes: t.lanes.map((lane) => ({
      id: timelineLaneId(id, lane.lane),
      name: lane.lane,
      color: lane.color ?? "",
      disabled: !!lane.disabled,
      clips: expandEvents(lane.events ?? [], ctx, undefined, [id]).flatMap(
        place,
      ),
    })),
  }));
}

/** A timeline's lane as a track, for whoever reads tracks — a verb finding a lane, the view drawing one. */
export function timelineLaneTrack(l: TimelineLaneDoc): TrackDoc {
  return {
    id: l.id,
    name: l.name,
    role: "regular",
    // Either kind: it plays through whichever lane the timeline is placed on.
    contentType: "audio notes",
    group: "",
    generated: false,
    color: l.color,
    mute: false,
    solo: false,
    disabled: l.disabled,
    inputChannels: [],
    outputChannels: [],
    monitor: "off",
    inputGain: 0,
    clips: l.clips,
    plugins: [],
    sends: [],
    automation: [],
  };
}
