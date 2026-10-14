// transitions.ts — the TWO transitions this renderer owns. `fade_in: 1` names the dissolve, so a
// song that only ever dissolves needs no `modules/` folder and the document carries no GLSL for it;
// `over` is what a fade naming a `chain:` and no `with:` blends by — the stretch's own alpha.
// A module of the same name on disk overrides either, which is the loader's rule everywhere else.
// See song-video/docs/transitions.md.

import type { SceneTransition } from "./scene";

/** The name a bare `fade_in: 1` compiles to — mirrored in @studio/song-schema's `DISSOLVE`. */
export const DISSOLVE = "dissolve";

/** …and the one a stretch with no `with:` compiles to — mirrored in @studio/song-schema's `OVER`. */
export const OVER = "over";

// The vertex stage every full-target program wants, and the same one a shader module ships.
const VERTEX = `#version 300 es
in vec2 aUnit;
out vec2 vUV;
void main() {
  vUV = aUnit;
  gl_Position = vec4(aUnit * 2.0 - 1.0, 0.0, 1.0);
}`;

// Premultiplied on both sides, which is what makes ONE mix serve a cross-dissolve AND a fade to
// nothing: against a transparent texel the colour and the coverage fall off together, so the
// layer beneath shows through instead of the picture darkening on its way out.
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
out vec4 outColor;
void main() {
  outColor = mix(texture(uFrom, vUV), texture(uTo, vUV), uProgress);
}`;

/** The built-in, in the shape a compiled one has — so the compositor holds one map and not two. */
export const builtinDissolve = (): SceneTransition => ({
  name: DISSOLVE,
  vertex: VERTEX,
  fragment: FRAGMENT,
  params: { P1: 0, P2: 0, P3: 0, P4: 0 },
});

// Straight alpha in, as a pass leaves it; PREMULTIPLIED out, as every blend's result is composited.
const OVER_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uFrom;
uniform sampler2D uTo;
out vec4 outColor;
void main() {
  vec4 a = texture(uFrom, vUV);
  vec4 b = texture(uTo, vUV);
  float under = a.a * (1.0 - b.a);
  outColor = vec4(b.rgb * b.a + a.rgb * under, b.a + under);
}`;

/** The incoming shot laid OVER the outgoing one by its own alpha — `uProgress` unread, the stretch having spent it. */
export const builtinOver = (): SceneTransition => ({
  name: OVER,
  vertex: VERTEX,
  fragment: OVER_FRAGMENT,
  params: { P1: 0, P2: 0, P3: 0, P4: 0 },
});
