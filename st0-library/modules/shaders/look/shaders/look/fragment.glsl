#version 300 es
// "look" — the node's `.cube` LUT over the picture, mixed in by P1.
//
// A LUT maps DISPLAY values, the way a `.cube` from a grading tool is made, so the picture is
// looked up as it arrives. The lookup is offset by half a texel each side, so 0 and 1 land on the
// first and last entries rather than half outside them.
precision mediump float;
precision mediump sampler3D;

in vec2 vUV;

uniform sampler2D uTex;
uniform sampler3D uLut;
uniform float uLutSize; // 0 while the file loads, or when the node names none
uniform float uP1;      // strength

out vec4 outColor;

void main() {
  vec4 src = texture(uTex, vUV);
  if (uLutSize < 2.0) {
    outColor = src;
    return;
  }
  vec3 at = clamp(src.rgb, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
  vec3 graded = texture(uLut, at).rgb;
  outColor = vec4(mix(src.rgb, graded, uP1), src.a);
}
