// videoTracks.ts — the picture lanes -> VideoTrackDoc[], in draw order, with the check the module
// schema cannot make since it does not know a lane is picture: a last open-ended shot fading out.
// Its own file rather than a section of nodeProject.ts because the two are two compiles of one
// folder, and only this one's output ever draws. See docs/picture.md.

import { readFileSync } from "node:fs";
import { confineToProject } from "@studio/song/confine";
import type {
  RawClip,
  RawVideoPlacement,
  RawVideoTrack,
} from "@studio/song/rawDoc";
import type { RawTimeline } from "@studio/song/timelinePictures";
import {
  ANIMATED_PROPS,
  type AnimatedProp,
  AnimateSchema,
  type Key,
  keysOf,
} from "@studio/song-schema/keyframes";
import { DISSOLVE, OVER } from "@studio/song-schema/moduleTypes";
import { timelineLaneId } from "@studio/song-schema/timelineLane";
import {
  CAPTION_SOURCE,
  IMAGE_SOURCE,
} from "@studio/song-schema/yaml/entitySchemas";
import { parseCaptions } from "./captions";
import type {
  CaptionsDoc,
  VideoClipDoc,
  VideoFadeDoc,
  VideoTrackDoc,
} from "./videoDoc";

/** A placement's fade in the ONE shape everything downstream copies — the scalar's sugar is undone HERE. */
// Normalised at the first hop so the union never leaves song-schema and five later copies see one shape.
export function readFade(raw: unknown): VideoFadeDoc | undefined {
  if (typeof raw === "number")
    return raw > 0 ? { over: raw, with: DISSOLVE } : undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const map = raw as { over?: unknown; with?: unknown; chain?: unknown };
  const over = Number(map.over ?? 0);
  if (!(over > 0)) return undefined; // a zero-length fade is a cut, which is the absence of one
  const chain = typeof map.chain === "string" && map.chain ? map.chain : "";
  // A stretch with no `with` mixes by its OWN alpha, so the blend is `over` rather than a dissolve.
  const kind = map.with ?? (chain ? OVER : DISSOLVE);
  return { over, with: String(kind), ...(chain ? { chain } : {}) };
}

/** A placement's `animate:` as sorted keys per property, or undefined; a malformed map is the schema's to report, on its line. */
export function readAnimate(
  raw: unknown,
): Partial<Record<AnimatedProp, Key[]>> | undefined {
  const parsed = AnimateSchema.safeParse(raw);
  if (raw == null || !parsed.success) return undefined;
  const out: Partial<Record<AnimatedProp, Key[]>> = {};
  for (const p of ANIMATED_PROPS) {
    const a = parsed.data[p];
    if (a !== undefined) out[p] = keysOf(a);
  }
  return Object.keys(out).length ? out : undefined;
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
  const animate = readAnimate(p.animate);
  const placedBy = p.timeline ? { timeline: p.timeline } : {};
  // No ref is an ACTIVATION: a span with no picture in it, saying the lane is on — docs/shapes.md.
  if (!ref)
    return {
      id: "",
      name: "",
      source: "",
      start: Number(p.start ?? 0),
      length: Number(p.length ?? 0),
      sourceFrom: 0,
      ...(animate ? { animate } : {}),
      ...placedBy,
    };
  if (!clipsMap[ref])
    warnings?.push(
      `${lane ? `${lane}: ` : ""}'${ref}' names no clip — add clips/${ref}.k7x, or this shot draws nothing`,
    );
  // A source outside the project's roots is no file at all (@studio/song docs/confine.md).
  const source = clipsMap[ref]?.source
    ? confineToProject(dir, String(clipsMap[ref].source))
    : "";
  if (source === null)
    warnings?.push(
      `${lane ? `${lane}: ` : ""}'${ref}' names a file outside the project — this shot draws nothing`,
    );
  // A derived copy outside the roots is dropped, and the shot falls back to its source.
  const optimized = confineToProject(dir, clipsMap[ref]?.optimized);
  const proxy = confineToProject(dir, clipsMap[ref]?.proxy);
  const fadeIn = readFade(p.fadeIn);
  const fadeOut = readFade(p.fadeOut);
  // Absent stays absent: a shot at its source's own pace says nothing about speed.
  const speed = Number(p.speed ?? 1);
  return {
    id: ref,
    name: ref,
    source: source ?? "",
    ...(optimized ? { optimized } : {}),
    ...(proxy ? { proxy } : {}),
    ...(IMAGE_SOURCE.test(String(clipsMap[ref]?.source ?? ""))
      ? { still: true as const }
      : {}),
    start: Number(p.start ?? 0),
    length: Number(p.length ?? 0),
    sourceFrom: Number(p.from ?? 0),
    // Absent stays absent, the way a lane with no chain carries no `plugins`.
    ...(fadeIn ? { fadeIn } : {}),
    ...(fadeOut ? { fadeOut } : {}),
    ...(animate ? { animate } : {}),
    ...(Number.isFinite(speed) && speed !== 1 ? { speed } : {}),
    ...(typeof p.effect === "string" && p.effect ? { effect: p.effect } : {}),
    ...captionsOf(dir, clipsMap[ref], ref, warnings),
    ...placedBy,
  };
}

/** A subtitle clip's cues and style, read off its file, as `{ captions }` — or nothing for any other clip. */
function captionsOf(
  dir: string,
  clip: RawClip | undefined,
  ref: string,
  warnings?: string[],
): { captions?: CaptionsDoc } {
  const source = String(clip?.source ?? "");
  if (!clip || !CAPTION_SOURCE.test(source)) return {};
  const path = confineToProject(dir, source);
  if (path === null) {
    warnings?.push(
      `'${ref}': ${source} is outside the project — its captions draw nothing`,
    );
    return { captions: { cues: [], style: {} } };
  }
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    warnings?.push(
      `'${ref}': ${source} could not be read — its captions draw nothing`,
    );
    return { captions: { cues: [], style: {} } };
  }
  const { cues, problems } = parseCaptions(text);
  for (const p of problems) warnings?.push(`'${ref}': ${source}, ${p}`);
  const c = clip as Record<string, unknown>;
  const str = (k: string) =>
    typeof c[k] === "string" && c[k] ? { [k]: c[k] } : {};
  return {
    captions: {
      cues,
      style: {
        ...str("font"),
        ...(typeof c.font_size === "number" ? { fontSize: c.font_size } : {}),
        ...str("color"),
        ...str("background"),
        ...str("align"),
        ...str("position"),
        ...(typeof c.margin === "number" ? { margin: c.margin } : {}),
      } as CaptionsDoc["style"],
    },
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

/** The lanes a project draws, in `order` — bottom first, the rows' order reversed by the caller. */
export function compileVideoTracks(
  dir: string,
  layersRaw: unknown,
  videoTracksMap: Record<string, RawVideoTrack>,
  clipsMap: Record<string, RawClip>,
  /** The frame, so a lane STATING no rect can fill it — see docs/picture.md. */
  viewport: readonly [number, number] = [0, 0],
  /** `project.k7x`'s `soloed:` — the SAME list audio reads, each compile filtering to its own lanes. */
  soloed: readonly string[] = [],
  /** Non-fatal problems, pushed as they are found: a blank lane has to be able to say why. */
  warnings?: string[],
): VideoTrackDoc[] {
  const layers = (Array.isArray(layersRaw) ? layersRaw : []).map(String);
  // A fadeOut needs an END: only the LAST length-0 shot has none, since an earlier one ends where the next starts.
  const errs: string[] = [];
  for (const id of layers) {
    const ev = videoTracksMap[id]?.events ?? [];
    const last = ev[ev.length - 1];
    if (last?.fadeOut && !Number(last.length ?? 0))
      errs.push(
        `${id}: its last shot fades out but has \`length(0)\` with nothing after it — give it a length, or put a shot after it`,
      );
  }
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
      // What a lane draws INSTEAD of placements comes off graph.k7x, and is folded in there.
      shapes: [],
    };
  });
}

/** Each timeline's own picture lanes at its own positions, framed like the song lane each draws on. */
export function compileTimelinePictures(
  dir: string,
  timelines: Record<string, RawTimeline>,
  /** The song's lanes, already compiled: a timeline's lane takes the frame of the one of its name. */
  layers: readonly VideoTrackDoc[],
  clipsMap: Record<string, RawClip>,
  viewport: readonly [number, number],
  warnings?: string[],
): Record<string, VideoTrackDoc[]> {
  const out: Record<string, VideoTrackDoc[]> = {};
  for (const [timeline, t] of Object.entries(timelines)) {
    if (!t.pictures?.length) continue;
    out[timeline] = t.pictures.map((lane) => {
      const id = timelineLaneId(timeline, lane.lane);
      const host = layers.find((l) => l.id === lane.lane);
      if (!host)
        warnings?.push(
          `${id} draws on the song's picture lane '${lane.lane}', and there is none — 'picture lane new ${lane.lane}' adds it`,
        );
      return {
        id,
        name: lane.lane,
        color: lane.color ?? "",
        mute: !!lane.disabled,
        solo: false,
        x: host?.x ?? 0,
        y: host?.y ?? 0,
        w: host?.w ?? viewport[0],
        h: host?.h ?? viewport[1],
        clips: (lane.events ?? []).map((p) =>
          videoPlacementToClip(
            dir,
            p as RawVideoPlacement,
            clipsMap,
            warnings,
            id,
          ),
        ),
        shapes: [],
      };
    });
  }
  return out;
}

/** Where the last picture ends, in seconds; a length-0 clip contributes its `start` alone. */
export function videoDuration(tracks: VideoTrackDoc[]): number {
  let end = 0;
  for (const t of tracks)
    for (const c of t.clips)
      end = Math.max(end, c.start + Math.max(0, c.length));
  return end;
}
