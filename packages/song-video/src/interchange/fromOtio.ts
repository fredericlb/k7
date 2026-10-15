// fromOtio.ts — an OpenTimelineIO timeline read into a cut: its VIDEO tracks, their clips laid
// end to end with gaps between, a time warp as a speed, a transition as the incoming shot's
// fade. Clip.1 and Clip.2 are both read, since a file written by a newer OTIO names its media in
// a map. Audio tracks are left out: a shot's sound here is its own lane's. See docs/interchange.md.

import {
  dissolveIntoFadeIn,
  type ImportedCut,
  type ImportedShot,
  type ImportedTrack,
} from "./imported";

type Json = Record<string, unknown>;

const schemaOf = (o: Json): string =>
  String(o.OTIO_SCHEMA ?? "").split(".")[0] ?? "";

// A RationalTime as seconds; a missing one is 0, which is what an unset offset means.
const sec = (t: unknown): number => {
  const r = t as { value?: number; rate?: number } | undefined;
  return r?.rate ? Number(r.value ?? 0) / r.rate : 0;
};

// The media a clip names: the default of a Clip.2's map, else a Clip.1's own reference.
function mediaOf(clip: Json): string {
  const refs = clip.media_references as Record<string, Json> | undefined;
  const ref = refs
    ? refs[String(clip.active_media_reference_key ?? "DEFAULT_MEDIA")]
    : (clip.media_reference as Json | undefined);
  const url = ref?.target_url;
  return typeof url === "string" ? url : "";
}

// A clip's speed from its effects: a freeze is 0, a linear warp its scalar, nothing 1.
function speedOf(clip: Json): number | undefined {
  for (const e of (clip.effects as Json[] | undefined) ?? []) {
    const kind = schemaOf(e);
    if (kind === "FreezeFrame") return 0;
    if (kind === "LinearTimeWarp") return Number(e.time_scalar ?? 1);
  }
  return undefined;
}

function readTrack(track: Json, skipped: string[]): ImportedTrack {
  const name = String(track.name ?? "");
  const shots: ImportedShot[] = [];
  let at = 0;
  let pending: { in: number; out: number } | null = null;
  for (const item of (track.children as Json[] | undefined) ?? []) {
    const kind = schemaOf(item);
    const range = item.source_range as Json | undefined;
    const duration = sec(range?.duration);
    if (kind === "Transition") {
      // A transition takes no time on the track: it straddles the cut between its neighbours.
      pending = { in: sec(item.in_offset), out: sec(item.out_offset) };
      continue;
    }
    if (kind === "Gap") {
      at += duration;
      pending = null;
      continue;
    }
    if (kind !== "Clip") {
      skipped.push(
        `${name}: a nested ${kind || "item"} is not carried — flatten it first`,
      );
      at += duration;
      continue;
    }
    const shot: ImportedShot = {
      name: String(item.name ?? "") || `shot-${shots.length + 1}`,
      media: mediaOf(item),
      start: at,
      length: duration,
      sourceFrom: sec(range?.start_time),
      ...(speedOf(item) !== undefined ? { speed: speedOf(item) } : {}),
    };
    if (pending)
      dissolveIntoFadeIn(shots.at(-1), shot, pending.in, pending.out);
    pending = null;
    shots.push(shot);
    at += duration;
  }
  return { name, shots };
}

/** Read an `.otio` file's text into a cut; throws only when it is no OTIO timeline at all. */
export function fromOtio(text: string): ImportedCut {
  const t = JSON.parse(text) as Json;
  if (schemaOf(t) !== "Timeline")
    throw new Error("not an OpenTimelineIO timeline");
  const stack = t.tracks as Json | undefined;
  const skipped: string[] = [];
  const tracks: ImportedTrack[] = [];
  let fps = 0;
  for (const tr of (stack?.children as Json[] | undefined) ?? []) {
    if (String(tr.kind ?? "Video") !== "Video") {
      skipped.push(
        `${String(tr.name ?? "a track")}: an ${String(tr.kind).toLowerCase()} track — a shot's sound comes from its own lane here`,
      );
      continue;
    }
    const first = ((tr.children as Json[] | undefined) ?? []).find(
      (c) => (c.source_range as Json | undefined)?.duration,
    );
    fps ||= Number(
      ((first?.source_range as Json | undefined)?.duration as Json | undefined)
        ?.rate ?? 0,
    );
    tracks.push(readTrack(tr, skipped));
  }
  return {
    name: String(t.name ?? "") || "cut",
    fps: fps || 25,
    tracks,
    skipped,
  };
}
