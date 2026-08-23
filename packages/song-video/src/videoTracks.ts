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
import type { ShapeDoc, VideoClipDoc, VideoTrackDoc } from "./videoDoc";

// A placement -> a VideoClipDoc, in plain DECIMAL SECONDS: no tempo map ever reaches picture.
export function videoPlacementToClip(
  dir: string,
  p: RawVideoPlacement,
  clipsMap: Record<string, RawClip>,
): VideoClipDoc {
  const ref = String(p.ref ?? "");
  return {
    id: ref,
    name: ref,
    source: clipsMap[ref] ? resolve(dir, String(clipsMap[ref].source)) : "",
    start: Number(p.start ?? 0),
    length: Number(p.length ?? 0),
    sourceFrom: Number(p.source_from ?? 0),
  };
}

// One shape -> a ShapeDoc in viewport px; the fill reads `background_color` or `color`, each the other's fallback.
export function compileShape(s: Record<string, unknown>): ShapeDoc {
  const x = Number(s.x ?? 0);
  const y = Number(s.y ?? 0);
  const fill = String(s.background_color ?? s.color ?? "#ffffff");
  switch (s.type) {
    case "circle":
      return { type: "circle", x, y, r: Number(s.r ?? 0), color: fill };
    case "text":
      return {
        type: "text",
        content: String(s.content ?? ""),
        font: String(s.font ?? "sans-serif"),
        fontSize: Number(s.font_size ?? s.fontSize ?? 24),
        x,
        y,
        ...(s.w != null ? { w: Number(s.w) } : {}),
        color: String(s.color ?? s.background_color ?? "#ffffff"),
      };
    default: // "square"
      return {
        type: "square",
        x,
        y,
        w: Number(s.w ?? 0),
        h: Number(s.h ?? 0),
        color: fill,
      };
  }
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

  return layers.map((id: string) => {
    const t = videoTracksMap[id] ?? {};
    const kind = t.kind === "shape" ? "shape" : "video";
    return {
      id,
      name: String(t.name ?? id),
      color: String(t.color ?? ""),
      mute: !!t.mute,
      kind,
      x: Number(t.x ?? 0),
      y: Number(t.y ?? 0),
      w: Number(t.w ?? 0),
      h: Number(t.h ?? 0),
      // Only the matching field is read downstream, so the other stays empty.
      clips:
        kind === "video"
          ? (Array.isArray(t.events) ? t.events : []).map((p) =>
              videoPlacementToClip(dir, p, clipsMap),
            )
          : [],
      shapes:
        kind === "shape"
          ? (Array.isArray(t.shapes) ? t.shapes : []).map((sh) =>
              compileShape((sh ?? {}) as Record<string, unknown>),
            )
          : [],
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
