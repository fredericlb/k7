// videoSound.ts — a picture lane's shots -> the audio clips of the lane that plays their sound
// (`video_source:`). Each shot is heard exactly where it is SEEN: over its span, minus whatever a
// later shot covers, so a cut in the picture is a cut in the sound and a dissolve a crossfade.
// The one thing a reader gets wrong: the sound is the clip file's `sound:`, never its `source:` —
// the engine cannot read a video container everywhere. See docs/videoSound.md.

import { resolve } from "node:path";
import { placementId } from "@studio/song-schema/placementId";
import type { ClipDoc } from "./project";
import type { RawClip, RawVideoPlacement, RawVideoTrack } from "./rawDoc";
import { wsExists } from "./yaml/workspaceFile";

/** One shot as the picture rule reads it, in seconds; `end` is Infinity for an open-ended last one. */
interface Shot {
  /** Its index in the lane's `events:`, which a verb edits it by. */
  index: number;
  ref: string;
  start: number;
  end: number;
  sourceFrom: number;
  /** How fast the source runs under the shot, signed — song-video docs/speed.md. */
  speed: number;
  fadeIn: number;
  fadeOut: number;
  silent: boolean;
}

// A fade's length in seconds, a bare number or a map's `over`; song-video's `readFade` would be a package cycle.
function fadeOver(raw: unknown): number {
  const over =
    typeof raw === "number" ? raw : (raw as { over?: unknown } | null)?.over;
  const n = Number(over ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The picture's own interval rule (ui-eyes timeline.ts `endOf`): a length, else the next entry's start, else open.
function shotsOf(events: readonly RawVideoPlacement[]): Shot[] {
  return events.map((p, i) => {
    const start = Number(p.start ?? 0);
    const length = Number(p.length ?? 0);
    const next = events[i + 1];
    const end =
      length > 0
        ? start + length
        : next
          ? Number(next.start ?? 0)
          : Number.POSITIVE_INFINITY;
    const span = end - start;
    return {
      index: i,
      ref: String(p.ref ?? ""),
      start,
      end,
      sourceFrom: Number(p.from ?? 0),
      speed: Number.isFinite(Number(p.speed ?? 1)) ? Number(p.speed ?? 1) : 1,
      // A fade is clamped to its own shot, as the picture clamps it.
      fadeIn: Math.min(fadeOver(p.fadeIn), span),
      fadeOut: Number.isFinite(end) ? Math.min(fadeOver(p.fadeOut), span) : 0,
      silent: p.silent === true,
    };
  });
}

/** `[a, b)` with `[c, d)` cut out of it — zero, one or two pieces. */
function subtract(
  spans: [number, number][],
  c: number,
  d: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    if (d <= a || c >= b) out.push([a, b]);
    else {
      if (c > a) out.push([a, c]);
      if (d < b) out.push([d, b]);
    }
  }
  return out;
}

/** One engine clip of a lane's sound, and the index in `events:` of the shot it is the sound of. */
export interface SoundPiece {
  shot: number;
  clip: ClipDoc;
}

/** What one video lane's shots sound like, as engine clips; a shot whose clip states no `sound:` is silent. */
export function videoSoundClips(
  dir: string,
  lane: RawVideoTrack,
  clipsMap: Record<string, RawClip>,
  tempo: number,
): ClipDoc[] {
  return videoSoundPieces(dir, lane, clipsMap, tempo).map((p) => p.clip);
}

/** `videoSoundClips`, each clip with the shot it came from — what removing one sound clip silences. */
export function videoSoundPieces(
  dir: string,
  lane: RawVideoTrack,
  clipsMap: Record<string, RawClip>,
  tempo: number,
): SoundPiece[] {
  const bps = tempo / 60;
  // Every event times its neighbour; one with no `ref` is an ACTIVATION, which covers and sounds nothing.
  const shots = shotsOf(Array.isArray(lane.events) ? lane.events : []).filter(
    (s) => s.ref !== "",
  );
  const out: SoundPiece[] = [];
  shots.forEach((s, i) => {
    const sound = clipsMap[s.ref]?.sound;
    // A freeze holds one frame and a reverse runs a clip backwards, which the engine cannot: both are silent (docs/videoSound.md).
    if (!sound || !(s.speed > 0) || s.silent) return;
    // A LATER shot covers this one once its own fadeIn is done; during that fade the two cross.
    let spans: [number, number][] = [[s.start, s.end]];
    const crossAt = new Map<number, number>();
    for (const later of shots.slice(i + 1)) {
      const from = later.start + later.fadeIn;
      if (from < later.end) spans = subtract(spans, from, later.end);
      if (later.fadeIn > 0) crossAt.set(from, later.fadeIn);
    }
    for (const [a, b] of spans) {
      if (!(b > a)) continue;
      const open = !Number.isFinite(b);
      const fadeIn = a === s.start ? s.fadeIn : 0;
      // Ending where a later shot finishes fading in is that crossfade's outgoing half, as the incoming fadeIn IS the transition.
      const fadeOut = crossAt.get(b) ?? (b === s.end ? s.fadeOut : 0);
      const sourceFrom = s.sourceFrom + (a - s.start) * s.speed;
      const clip: ClipDoc = {
        id: placementId(s.ref, a * bps),
        type: "audio",
        name: s.ref,
        source: resolve(dir, sound),
        start: a * bps,
        // 0 is the engine's "natural length": an open-ended last shot plays to the end of its file.
        length: open ? 0 : (b - a) * bps,
        offset: 0,
        ...(sourceFrom > 0 ? { sourceFrom } : {}),
        ...(open ? {} : { sourceTo: sourceFrom + (b - a) * s.speed }),
        // A retimed shot's sound is RESAMPLED, as a tape would be: one second of song takes `speed` seconds of source.
        ...(s.speed !== 1
          ? {
              warp: {
                algorithm: "varispeed",
                markers: [
                  [0, sourceFrom],
                  [bps, sourceFrom + s.speed],
                ] as [number, number][],
              },
            }
          : {}),
        fadeIn: fadeIn * bps,
        fadeOut: fadeOut * bps,
        loopStart: 0,
        loopEnd: 0,
        notes: [],
      };
      out.push({ shot: s.index, clip });
    }
  });
  return out;
}

/** Every `video_source:` lane's clips, by lane; what cannot be honoured is pushed on `errs`, as a lane's own faults are. */
export function videoSoundLanes(
  dir: string,
  lanes: Record<string, { events: readonly unknown[]; videoSource?: string }>,
  videoLanes: Record<string, RawVideoTrack>,
  clipsMap: Record<string, RawClip>,
  tempo: number,
  errs: string[],
): Map<string, ClipDoc[]> {
  const out = new Map<string, ClipDoc[]>();
  for (const [id, lane] of Object.entries(lanes)) {
    const from = lane.videoSource;
    if (!from) continue;
    if (lane.events.length) {
      errs.push(
        `lane '${id}': video_source '${from}' and events: both — its events ARE that picture lane's shots, so drop one`,
      );
      continue;
    }
    const picture = videoLanes[from];
    if (!picture) {
      errs.push(
        `lane '${id}': video_source names '${from}', which is not a picture lane (a \`@meta/picture-track\` node)`,
      );
      continue;
    }
    const clips = videoSoundClips(dir, picture, clipsMap, tempo);
    // A missing sound file is refused as a missing audio clip is: the engine would play silence and say nothing.
    for (const name of new Set(clips.map((c) => c.name))) {
      const sound = String(clipsMap[name]?.sound);
      if (!wsExists(resolve(dir, sound)))
        errs.push(
          `lane '${id}': shot '${name}' sounds ${sound}, which is not there — 'picture sound ${from}' extracts it again`,
        );
    }
    out.set(id, clips);
  }
  return out;
}
