// scene.ts — the renderer's input and the boundary it lives behind: a viewport, an fps,
// and a stack of layers holding video placements in DECIMAL SECONDS. That is ALL eyes
// knows — it imports none of the brain's Node packages, so whoever has a ProjectDoc adapts
// into this plain structural type. That boundary is what lets it run in a browser.

// One video clip on a layer's timeline, in seconds.
export interface SceneClip {
  id: string;
  src: string; // a URL the runtime can load (realtime: a <video> src; export: fetch bytes)
  start: number; // when it appears on the timeline
  length: number; // 0 == to the end of the source
  sourceFrom: number; // the in-point INTO the source
  fadeIn?: SceneFade; // over its own start; absent is a hard cut
  fadeOut?: SceneFade; // over its own end
  animate?: SceneAnimate; // how it moves in its lane's frame; absent costs nothing — docs/motion.md
  speed?: number; // how fast the source runs under it, signed; absent is 1 — song-video/docs/speed.md
}

/** A shot's animated properties, each its sorted keys in seconds from the shot's start; `ease` shapes the segment leaving a key. */
export type SceneAnimate = Partial<
  Record<
    "x" | "y" | "scale" | "opacity" | "rotate",
    readonly { t: number; v: number; ease: string }[]
  >
>;

/** How a shot arrives or leaves: how long, and which program draws it — `with` keys `VideoScene.transitions`. */
export interface SceneFade {
  over: number; // seconds
  with: string; // a transition name, or "dissolve" / "over" — the two this renderer owns
  chain?: string; // the stretch this shot runs through over the fade — keys `VideoScene.stretches`
}

/** A transition's two stages, shared by every cut that names it — one program per name, not per cut. */
export interface SceneTransition {
  name: string;
  vertex: string;
  fragment: string;
  params: Record<string, number>; // uP1..uP4, each 0..1
}

// A drawn primitive on a shape layer — a fill or text, static while its layer is unhidden; it carries its own geometry, see docs/compositor.md.
export type SceneShape =
  | {
      id: string;
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      type: "circle";
      x: number;
      y: number;
      r: number;
      color: string;
    }
  | {
      id: string;
      type: "text";
      content: string;
      font: string; // a CSS font-family
      fontSize: number; // px
      x: number;
      y: number;
      w?: number; // optional max width — the text condenses to fit it (single line)
      color: string;
    };

/** One GLSL pass over a picture — plain source and plain numbers, `audio` being the live level the host refreshes per frame. */
export interface ScenePass {
  id: string;
  name: string; // the node's name, for a compile error that says which card to look at
  vertex: string;
  fragment: string;
  enabled: boolean;
  params: Record<string, number>; // uP1..uP4, each 0..1
  audio: number; // uAudio, 0..1 — replaced every frame by the host
}

// A layer in the draw stack: a VIDEO lane (a rect plus clips), a SHAPE lane, or a CAMERA — the
// third discriminated by `camera` being present, since a live lane holds no clips and no shapes.
export interface VideoLayer {
  id: string;
  hidden: boolean;
  /** A LIVE picture fills this layer: the camera's LABEL, or "" for whichever is default.
   *
   * A label rather than a deviceId because an id is salted per browser and per origin — the
   * runtime matches this against what it enumerates. See packages/song/docs/camera.md. */
  camera?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  clips: SceneClip[];
  shapes?: SceneShape[];
  // Passes over THIS layer, in order, before it is composited; absent is the ordinary case and costs nothing.
  passes?: ScenePass[];
}

export interface VideoScene {
  viewport: [number, number]; // px
  fps: number; // used by export only
  layers: VideoLayer[]; // ALREADY in draw order, bottom first
  durationSec: number; // the last clip's end across all layers (export frame count)
  // …and passes over the FRAME the layers were composited into; with none, `draw` writes straight to the canvas.
  framePasses?: ScenePass[];
  // Every named transition in the scene, by name — SCENE-level, since one program serves every lane and cut.
  transitions?: Record<string, SceneTransition>;
  // …and every STRETCH a fade names, by head node: the passes a shot runs through on its way in or out.
  stretches?: Record<string, ScenePass[]>;
}

// The structural shape of a brain VideoTrackDoc minus the absolute path, declared here so eyes stays brain-free.
export interface SceneLayerInput {
  id: string;
  mute: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  clips: {
    id: string;
    src: string;
    start: number;
    length: number;
    sourceFrom: number;
    fadeIn?: SceneFade;
    fadeOut?: SceneFade;
    animate?: SceneAnimate;
    speed?: number;
  }[];
  shapes?: SceneShape[];
  passes?: ScenePass[];
  /** See `VideoLayer.camera` — a live lane, which holds no clips at all. */
  camera?: string;
}

// Assemble a VideoScene from already-adapted layers; a natural-length clip contributes only its start to durationSec.
export function buildScene(
  viewport: [number, number],
  fps: number,
  layers: SceneLayerInput[],
  framePasses: ScenePass[] = [],
  transitions: Record<string, SceneTransition> = {},
  stretches: Record<string, ScenePass[]> = {},
): VideoScene {
  let durationSec = 0;
  const built: VideoLayer[] = layers.map((l) => {
    for (const c of l.clips)
      durationSec = Math.max(durationSec, c.start + (c.length || 0));
    return {
      id: l.id,
      hidden: l.mute,
      // A LIVE lane, whose picture has no start and no end — so it adds nothing to `durationSec`.
      ...(l.camera === undefined ? {} : { camera: l.camera }),
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      clips: l.clips.map((c) => ({
        id: c.id,
        src: c.src,
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
        // Never dropped the way a bypassed pass is: a fade has no `enabled`, so absent means absent.
        ...(c.fadeIn ? { fadeIn: { ...c.fadeIn } } : {}),
        ...(c.fadeOut ? { fadeOut: { ...c.fadeOut } } : {}),
        ...(c.animate ? { animate: c.animate } : {}),
        ...(c.speed !== undefined ? { speed: c.speed } : {}),
      })),
      // Shapes carry no time, so they don't extend durationSec — a shapes-only song has no natural end to render.
      ...(l.shapes?.length ? { shapes: l.shapes.map((s) => ({ ...s })) } : {}),
      // A bypassed pass is dropped HERE rather than carried and skipped, so no program is allocated for something that never runs.
      ...(l.passes?.some((p) => p.enabled)
        ? { passes: l.passes.filter((p) => p.enabled).map((p) => ({ ...p })) }
        : {}),
    };
  });
  const frame = framePasses.filter((p) => p.enabled);
  const named = Object.entries(transitions);
  // A bypassed step is dropped as a lane's is; a stretch left with none still runs, as the identity.
  const runs = Object.entries(stretches).map(
    ([k, run]) =>
      [k, run.filter((p) => p.enabled).map((p) => ({ ...p }))] as const,
  );
  return {
    viewport,
    fps,
    layers: built,
    durationSec,
    ...(frame.length ? { framePasses: frame.map((p) => ({ ...p })) } : {}),
    ...(named.length
      ? {
          transitions: Object.fromEntries(
            named.map(([k, t]) => [k, { ...t, params: { ...t.params } }]),
          ),
        }
      : {}),
    ...(runs.length ? { stretches: Object.fromEntries(runs) } : {}),
  };
}
