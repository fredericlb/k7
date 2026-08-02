// timeline.ts — which clip a layer shows at time t, and where in its source. Pure and
// side-effect free (no WebGL, no DOM, no Date.now()), so it is unit-testable off a bare
// scene and shared verbatim: realtime calls it per rAF tick, export per frame.

import type { SceneClip, VideoLayer } from "./scene";

export interface Active {
  clip: SceneClip;
  // Where in the SOURCE file this maps to, in seconds: sourceFrom + (t - start).
  sourceTime: number;
}

// The clip active on `layer` at `t`, or null. Intervals are half-open, so a cut boundary belongs to the LATER clip
// and a frame is never drawn from two. A length-0 clip runs to the next clip's start, or to the end.
export function activeAt(layer: VideoLayer, t: number): Active | null {
  const clips = layer.clips;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (t < c.start) continue;
    const end =
      c.length > 0
        ? c.start + c.length
        : i + 1 < clips.length
          ? clips[i + 1].start
          : Infinity;
    if (t < end) return { clip: c, sourceTime: c.sourceFrom + (t - c.start) };
  }
  return null;
}
