// otio.ts — the song's picture as an OpenTimelineIO timeline: one video track per lane, bottom
// first, the shots as clips on the camera ORIGINALS, the gaps as gaps, a fade_in as a dissolve and
// a speed as a time warp. Written in the OTIO 1 schemas every reader loads; newer readers upgrade
// them on read. What it cannot carry is in docs/interchange.md.

import type { VideoClipDoc, VideoProjectDoc } from "../videoDoc";
import { flattenLane } from "./flatten";

type Json = Record<string, unknown>;

// A time in the timeline's rate, rounded to a frame: OTIO is frame-based, and a cut between frames is not one.
const rt = (seconds: number, rate: number): Json => ({
  OTIO_SCHEMA: "RationalTime.1",
  rate,
  value: Math.round(seconds * rate),
});
const range = (start: number, duration: number, rate: number): Json => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: rt(start, rate),
  duration: rt(duration, rate),
});

// A speed as a reader of OTIO expects it: a linear warp, a freeze as its own schema.
function warp(speed: number): Json[] {
  if (speed === 1) return [];
  if (speed === 0)
    return [
      {
        OTIO_SCHEMA: "FreezeFrame.1",
        name: "",
        effect_name: "FreezeFrame",
        time_scalar: 0,
        metadata: {},
      },
    ];
  return [
    {
      OTIO_SCHEMA: "LinearTimeWarp.1",
      name: "",
      effect_name: "LinearTimeWarp",
      time_scalar: speed,
      metadata: {},
    },
  ];
}

export interface OtioOptions {
  name: string;
  /** Where the media is named FROM: the export sits in `exports/`, so a clip's path is relative to that. */
  mediaUrl: (c: VideoClipDoc) => string;
  /** A source's own length, for an open-ended last shot — the file service probes it. */
  naturalSeconds?: (c: VideoClipDoc) => number | undefined;
}

/** The timeline, as the JSON an `.otio` file holds, and the shots it had to leave out. */
export function toOtio(
  doc: VideoProjectDoc,
  o: OtioOptions,
): { json: string; skipped: string[] } {
  const rate = doc.fps;
  const skipped: string[] = [];
  const tracks = doc.videoTracks.map((lane) => {
    const flat = flattenLane(lane, o.naturalSeconds);
    skipped.push(...flat.skipped.map((s) => `${lane.id}: ${s}`));
    const children: Json[] = [];
    let at = 0;
    flat.segments.forEach((s, i) => {
      // A gap is an item of its own in OTIO: a track's items are laid end to end.
      if (s.start - at > 1e-6)
        children.push({
          OTIO_SCHEMA: "Gap.1",
          name: "",
          source_range: range(0, s.start - at, rate),
          effects: [],
          markers: [],
          metadata: {},
        });
      const d = flat.dissolves.find((x) => x.index === i);
      // The outgoing picture runs on under the dissolve, so the transition sits AFTER the cut.
      if (d)
        children.push({
          OTIO_SCHEMA: "Transition.1",
          name: "",
          transition_type: "SMPTE_Dissolve",
          in_offset: rt(0, rate),
          out_offset: rt(d.over, rate),
          metadata: {},
        });
      children.push({
        OTIO_SCHEMA: "Clip.1",
        name: s.clip.name,
        source_range: range(s.sourceFrom, s.end - s.start, rate),
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          name: s.clip.name,
          target_url: o.mediaUrl(s.clip),
          available_range: null,
          metadata: {},
        },
        effects: warp(s.clip.speed ?? 1),
        markers: [],
        metadata: s.clip.still ? { st0: { still: true } } : {},
      });
      at = s.end;
    });
    return {
      OTIO_SCHEMA: "Track.1",
      name: lane.name || lane.id,
      kind: "Video",
      source_range: null,
      children,
      effects: [],
      markers: [],
      metadata: {},
    };
  });
  const timeline = {
    OTIO_SCHEMA: "Timeline.1",
    name: o.name,
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      source_range: null,
      // A lane of shapes hands over nothing another editor can open, so it is no track at all.
      children: tracks.filter((t) => t.children.length),
      effects: [],
      markers: [],
      metadata: {},
    },
    metadata: { st0: { viewport: doc.viewport, fps: doc.fps } },
  };
  return { json: `${JSON.stringify(timeline, null, 2)}\n`, skipped };
}
