// timelineAudition.ts — the document the engine plays while a timeline is AUDITIONED: that timeline
// alone from beat 0, through the lane it is first placed on, and every other song lane silent.
// What a reader gets wrong: busses and the master stay as they are, since the host lane's sends and
// effects are what make the timeline sound as it does in the song. See docs/timelines.md.

import { materialRefOf } from "@studio/song-schema/placementId";
import { NEST_SEP } from "@studio/song-schema/timelineLane";
import { placeWithin, timelineLaneTrack } from "./compile/timelines";
import type { ClipDoc, ProjectDoc, TrackDoc } from "./project";

/** The engine tracks timeline `id` first plays through — both halves of one lane — or [] when it is placed nowhere. */
export function auditionHosts(doc: ProjectDoc, id: string): string[] {
  // A placement is named by the id prefix up to its own `<id>@<start>` segment, nested or not.
  const placementOf = (c: ClipDoc): string | null => {
    const segs = c.id.split(NEST_SEP).slice(0, -1);
    const at = segs.findIndex((s) => materialRefOf(s) === id);
    return at < 0 ? null : segs.slice(0, at + 1).join(NEST_SEP);
  };
  let first: { key: string; start: number } | null = null;
  const hostsOf = new Map<string, Set<string>>();
  for (const t of doc.tracks)
    for (const c of t.clips) {
      const key = c.nest ? placementOf(c) : null;
      if (!key) continue;
      hostsOf.set(key, (hostsOf.get(key) ?? new Set()).add(t.id));
      if (!first || c.start < first.start) first = { key, start: c.start };
    }
  return first ? [...(hostsOf.get(first.key) ?? [])] : [];
}

/** `doc` playing timeline `id` alone, from beat 0; `doc` itself when there is no such timeline. */
export function auditionTimeline(doc: ProjectDoc, id: string): ProjectDoc {
  const tl = doc.timelines?.find((t) => t.id === id);
  if (!tl) return doc;
  const clips = placeWithin(
    tl.lanes.flatMap((l) =>
      l.clips.map((c) => (l.disabled ? { ...c, disabled: true } : c)),
    ),
    {
      offset: 0,
      end: tl.length,
      gain: 0,
      disabled: false,
      prefix: `${id}${NEST_SEP}`,
      nest: { of: `${id}@0`, ref: id, start: 0, length: tl.length },
    },
  );
  const hosts = auditionHosts(doc, id);
  const takes = (t: TrackDoc, c: ClipDoc): boolean =>
    c.type === "midi"
      ? t.contentType.includes("notes")
      : t.contentType.includes("audio");
  // Each clip on the host half taking its kind, else the first: a lane wired one way still gets the other's material.
  const hostOf = (c: ClipDoc): string | undefined => {
    const own = doc.tracks.filter((t) => hosts.includes(t.id));
    return (own.find((t) => takes(t, c)) ?? own[0])?.id;
  };
  const tracks: TrackDoc[] = doc.tracks.map((t) => {
    if (hosts.includes(t.id))
      return {
        ...t,
        mute: false,
        solo: false,
        clips: clips.filter((c) => hostOf(c) === t.id),
      };
    // A return or the master is left alone: the host's sends reach it.
    if (t.role !== "regular") return t;
    return { ...t, clips: [], mute: true, solo: false };
  });
  // Placed nowhere: a bare track, so its audio is heard; its notes have no instrument to play them.
  if (!hosts.length)
    tracks.push(
      timelineLaneTrack({
        id: `${id}${NEST_SEP}`,
        name: id,
        color: "",
        disabled: false,
        clips,
      }),
    );
  return { ...doc, tracks, markers: [] };
}
