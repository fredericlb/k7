// timeline.ts — which clip a layer shows at time t, and where in its source. Pure and
// side-effect free (no WebGL, no DOM, no Date.now()), so it is unit-testable off a bare
// scene and shared verbatim: realtime calls it per rAF tick, export per frame.

import type { SceneClip, VideoLayer } from "./scene";

export interface Active {
  clip: SceneClip;
  // Where in the SOURCE file this maps to, in seconds: sourceFrom + (t - start).
  sourceTime: number;
}

// The clip active on `layer` at `t`, or null. Half-open intervals, so a cut belongs to the LATER clip; length 0 runs to the next start.
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
