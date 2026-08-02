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
}

// A drawn primitive on a shape layer — a fill or text, static and on while its layer is unhidden. `color` is any
// CSS colour the 2D canvas parses. Each shape carries its geometry, so the layer's own rect is ignored, and a
// square/text x,y is its top-left while a circle's is its CENTRE.
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

// A layer in the draw stack: a VIDEO lane (a rect plus clips) or a SHAPE lane. Non-empty `shapes` is the
// discriminator, and the two never mix on one layer.
export interface VideoLayer {
  id: string;
  hidden: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  clips: SceneClip[];
  shapes?: SceneShape[];
}

export interface VideoScene {
  viewport: [number, number]; // px
  fps: number; // used by export only
  layers: VideoLayer[]; // ALREADY in draw order, bottom first
  durationSec: number; // the last clip's end across all layers (export frame count)
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
  }[];
  shapes?: SceneShape[];
}

// Assemble a VideoScene from already-adapted layers. durationSec tells export how many frames to emit and
// realtime when the picture ends; a natural-length clip contributes only its start, its true end being unknown
// until the source opens.
export function buildScene(
  viewport: [number, number],
  fps: number,
  layers: SceneLayerInput[],
): VideoScene {
  let durationSec = 0;
  const built: VideoLayer[] = layers.map((l) => {
    for (const c of l.clips)
      durationSec = Math.max(durationSec, c.start + (c.length || 0));
    return {
      id: l.id,
      hidden: l.mute,
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
      })),
      // Shapes carry no time, so they don't extend durationSec — a shapes-only song has no natural end to render.
      ...(l.shapes?.length ? { shapes: l.shapes.map((s) => ({ ...s })) } : {}),
    };
  });
  return { viewport, fps, layers: built, durationSec };
}
