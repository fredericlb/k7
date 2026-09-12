// videoTracks.ts — video_tracks/ + project.layers -> VideoTrackDoc[], in draw order, with the
// three checks the schema cannot make (a layer naming nothing, a layer named twice, a lane no
// layer names). Its own file rather than a section of nodeProject.ts because the two are two
// compiles of one folder, and only this one's output ever draws. See docs/picture.md.

import { resolve } from "node:path";
import type {
  RawClip,
  RawVideoPlacement,
  RawVideoTrack,
} from "@studio/song/rawDoc";
import { DISSOLVE } from "@studio/song-schema/moduleTypes";
import type { VideoClipDoc, VideoFadeDoc, VideoTrackDoc } from "./videoDoc";

/** A placement's fade in the ONE shape everything downstream copies — the scalar's sugar is undone HERE. */
// Normalised at the first hop so the union never leaves song-schema and five later copies see one shape.
export function readFade(raw: unknown): VideoFadeDoc | undefined {
  if (typeof raw === "number")
    return raw > 0 ? { over: raw, with: DISSOLVE } : undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const over = Number((raw as { over?: unknown }).over ?? 0);
  if (!(over > 0)) return undefined; // a zero-length fade is a cut, which is the absence of one
  return { over, with: String((raw as { with?: unknown }).with ?? DISSOLVE) };
}

// A placement -> a VideoClipDoc, in plain DECIMAL SECONDS: no tempo map ever reaches picture.
export function videoPlacementToClip(
  dir: string,
  p: RawVideoPlacement,
  clipsMap: Record<string, RawClip>,
  /** Where a ref naming no clip is REPORTED — a shot with no source draws nothing and would say nothing. */
  warnings?: string[],
  lane?: string,
): VideoClipDoc {
  const ref = String(p.ref ?? "");
  // No ref is an ACTIVATION: a span with no picture in it, saying the lane is on — docs/shapes.md.
  if (!ref)
    return {
      id: "",
      name: "",
      source: "",
      start: Number(p.start ?? 0),
      length: Number(p.length ?? 0),
      sourceFrom: 0,
    };
  if (!clipsMap[ref])
    warnings?.push(
      `${lane ? `${lane}: ` : ""}'${ref}' names no clip — add clips/${ref}.yaml, or this shot draws nothing`,
    );
  const fadeIn = readFade(p.fade_in);
  const fadeOut = readFade(p.fade_out);
  return {
    id: ref,
    name: ref,
    source: clipsMap[ref] ? resolve(dir, String(clipsMap[ref].source)) : "",
    start: Number(p.start ?? 0),
    length: Number(p.length ?? 0),
    sourceFrom: Number(p.source_from ?? 0),
    // Absent stays absent, the way a lane with no chain carries no `plugins`.
    ...(fadeIn ? { fadeIn } : {}),
    ...(fadeOut ? { fadeOut } : {}),
  };
}

/** `viewport:` as [w, h] plus the export fps, an optional third element defaulting to 30. */
export function readViewport(proj: Record<string, unknown>): {
  viewport: [number, number];
  fps: number;
} {
  const vp = Array.isArray(proj.viewport) ? proj.viewport.map(Number) : [];
  return {
    viewport: [vp[0] || 0, vp[1] || 0],
    fps: vp[2] && vp[2] > 0 ? Number(vp[2]) : 30,
  };
}

/** The lanes a project draws, bottom first — `layers:` is the ORDER and the membership at once. */
export function compileVideoTracks(
  dir: string,
  layersRaw: unknown,
  videoTracksMap: Record<string, RawVideoTrack>,
  clipsMap: Record<string, RawClip>,
  /** The frame, so a lane STATING no rect can fill it — see docs/picture.md. */
  viewport: readonly [number, number] = [0, 0],
  /** `project.yaml`'s `soloed:` — the SAME list audio reads, each compile filtering to its own lanes. */
  soloed: readonly string[] = [],
  /** Non-fatal problems, pushed as they are found: a blank lane has to be able to say why. */
  warnings?: string[],
): VideoTrackDoc[] {
  const ids = Object.keys(videoTracksMap);
  const layers = (Array.isArray(layersRaw) ? layersRaw : []).map(String);
  const errs: string[] = [];

  const known = new Set(ids);
  const listed = new Set<string>();
  for (const id of layers) {
    if (!known.has(id))
      errs.push(
        `project.layers names '${id}', which is not a video track (add video_tracks/${id}.yaml, or remove it from layers)`,
      );
    if (listed.has(id))
      errs.push(`project.layers lists '${id}' more than once`);
    listed.add(id);
  }
  for (const id of ids)
    if (!listed.has(id))
      errs.push(
        `video track '${id}' is missing from project.layers (add it — layers decides draw order, bottom first)`,
      );

  if (errs.length)
    throw new Error(`video config invalid:\n  - ${errs.join("\n  - ")}`);

  const solos = new Set(soloed.map(String));
  return layers.map((id: string) => {
    const t = videoTracksMap[id] ?? {};
    return {
      id,
      name: String(t.name ?? id),
      color: String(t.color ?? ""),
      mute: !!t.mute,
      solo: solos.has(id),
      x: Number(t.x ?? 0),
      y: Number(t.y ?? 0),
      // No rect written is the WHOLE frame, as it already is for a camera layer: 0 would be a lane that draws nothing.
      w: Number(t.w ?? viewport[0]),
      h: Number(t.h ?? viewport[1]),
      clips: (Array.isArray(t.events) ? t.events : []).map((p) =>
        videoPlacementToClip(dir, p, clipsMap, warnings, id),
      ),
      // What a lane draws INSTEAD of placements comes off graph.yaml, and is folded in there.
      shapes: [],
    };
  });
}

/** Where the last picture ends, in seconds; a length-0 clip contributes its `start` alone. */
export function videoDuration(tracks: VideoTrackDoc[]): number {
  let end = 0;
  for (const t of tracks)
    for (const c of t.clips)
      end = Math.max(end, c.start + Math.max(0, c.length));
  return end;
}
