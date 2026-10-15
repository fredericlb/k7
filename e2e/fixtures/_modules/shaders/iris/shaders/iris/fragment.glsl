#version 300 es
// "iris" — the shot inside a circle whose radius follows `uPresence`: closed at 0, the whole
// frame at 1. Only the ALPHA changes, which is what lets the built-in `over` mix it with the shot
// underneath — see packages/song-video/docs/transitions.md.
precision mediump float;

in vec2 vUV;

uniform sampler2D uTex;       // the shot coming in
uniform float uPresence;      // 0..1, how much of the shot is on screen
uniform vec2 uResolution;     // the viewport, so the circle stays round on a wide frame
uniform float uP1;            // edge softness

out vec4 outColor;

void main() {
  vec4 c = texture(uTex, vUV);
  // Distance from the centre in units of the frame's HEIGHT, so a 16:9 frame does not squash the circle.
  vec2 d = (vUV - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float soft = max(uP1 * 0.5, 0.001);
  // The radius reaches past the corner at presence 1, edge included, so a whole shot has no rim.
  float far = length(vec2(uResolution.x / uResolution.y, 1.0) * 0.5) + soft;
  float r = uPresence * far;
  outColor = vec4(c.rgb, c.a * (1.0 - smoothstep(r - soft, r, length(d))));
}
