#version 300 es
// "grade" — exposure, contrast, saturation, temperature, in that order and each neutral at 0.5.
//
// Worked in LINEAR light, since an exposure in stops is a multiplication and only means one on
// linear values. The picture arrives sRGB-encoded, so it is decoded first and encoded again last.
precision mediump float;

in vec2 vUV;

uniform sampler2D uTex;
uniform float uP1; // exposure
uniform float uP2; // contrast
uniform float uP3; // saturation
uniform float uP4; // temperature

out vec4 outColor;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

void main() {
  vec4 src = texture(uTex, vUV);
  vec3 c = toLinear(src.rgb);

  // Exposure: ±2 stops, 0.5 being none at all.
  c *= exp2((uP1 - 0.5) * 4.0);

  // Temperature: warm lifts red and lowers blue, cool the other way; green is left as the anchor.
  float t = (uP4 - 0.5) * 0.4;
  c *= vec3(1.0 + t, 1.0, 1.0 - t);

  // Contrast about mid-grey, in display space, where "mid" is where the eye puts it.
  vec3 d = toDisplay(c);
  d = (d - 0.5) * (uP2 * 2.0) + 0.5;

  // Saturation against the Rec. 709 luma of the result: 0 grey, 1 doubled.
  float luma = dot(d, vec3(0.2126, 0.7152, 0.0722));
  d = mix(vec3(luma), d, uP3 * 2.0);

  // Alpha untouched, so a graded picture-in-picture still composites over the lane below it.
  outColor = vec4(clamp(d, 0.0, 1.0), src.a);
}
