#version 300 es
// "video-mixer" — a lane's channels scaled and its alpha thinned: the strip a picture lane is mixed with.
// The compositor blends straight alpha (SRC_ALPHA, ONE_MINUS_SRC_ALPHA), so transparency touches alpha alone.
precision mediump float;

in vec2 vUV;

uniform sampler2D uTex;
uniform float uP1; // red
uniform float uP2; // green
uniform float uP3; // blue
uniform float uP4; // transparency

out vec4 outColor;

void main() {
  vec4 src = texture(uTex, vUV);
  outColor = vec4(src.rgb * vec3(uP1, uP2, uP3), src.a * (1.0 - uP4));
}
