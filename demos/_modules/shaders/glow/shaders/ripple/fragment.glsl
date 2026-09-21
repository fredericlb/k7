#version 300 es
// "ripple" — rings running out from the centre, their depth driven by the sound.
//
// The second shader in this folder, and its job is to prove the dropdown: pick it instead of
// "pulse" and the same node, the same four knobs and the same audio cable do something else.
precision mediump float;

in vec2 vUV;

uniform sampler2D uTex;    // the picture coming in
uniform float uAudio;      // 0..1, the wired lane's live level
uniform float uTime;       // seconds — the TRANSPORT's position, not a clock of the renderer's
uniform vec2 uResolution;  // the viewport in px, for the aspect correction below
uniform float uP1;         // ring depth at full level
uniform float uP2;         // how many rings across the frame
uniform float uP3;         // how fast they travel

out vec4 outColor;

void main() {
  // Aspect-corrected, or the rings are ellipses on any frame that is not square. `uResolution` is
  // the VIEWPORT's — a layer's chain runs at viewport size whatever rect the lane occupies, which
  // is what keeps an effect looking the same on a picture-in-picture as on a full-frame lane.
  vec2 d = vUV - 0.5;
  d.x *= uResolution.x / max(uResolution.y, 1.0);
  float r = length(d);

  // 2..34 rings, and 0..2 rings per second outward. Both ends of each range are useful: the
  // bottom of `uP2` is a single slow swell, the top is a fine corduroy.
  float rings = 2.0 + uP2 * 32.0;
  float wave = sin(r * rings - uTime * uP3 * 2.0);

  // The displacement is along the radius, so the rings push the picture out and pull it back
  // rather than smearing it sideways. Guarded at the exact centre, where `d / r` is 0/0.
  float amount = wave * uAudio * uP1 * 0.05;
  vec2 dir = r > 0.0001 ? d / r : vec2(0.0);
  vec2 uv = clamp(vUV + dir * amount, 0.0, 1.0);

  outColor = texture(uTex, uv);
}
