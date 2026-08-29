#version 300 es
// "pulse" — the picture brightens with the sound, inside a vignette.
//
// The simplest thing that shows the audio input actually arriving: wire a lane to this node's
// `audio` port and the frame breathes with it. With nothing wired, `uAudio` is 0 and this is a
// vignette and nothing else, which is a legitimate way to use it.
precision mediump float;

in vec2 vUV;

uniform sampler2D uTex;   // the picture coming in
uniform float uAudio;     // 0..1, the wired lane's live level (-60..0 dB)
uniform float uP1;        // how hard the sound lifts the picture
uniform float uP2;        // vignette depth

out vec4 outColor;

void main() {
  vec4 c = texture(uTex, vUV);

  // Lift, never cut: at uAudio 0 this is 1.0, so silence leaves the picture exactly as it came in.
  // A shader that darkened at rest would make every lane look wrong the moment you added it.
  float lift = 1.0 + uAudio * uP1 * 2.0;

  // Squared distance from the centre, doubled so the corners reach ~1 on a square frame.
  vec2 d = vUV - 0.5;
  float vig = 1.0 - uP2 * clamp(dot(d, d) * 2.0, 0.0, 1.0);

  // Alpha is passed straight through. The layer is composited OVER whatever is under it, so
  // writing 1.0 here would make a picture-in-picture punch a hole in the lane below it.
  outColor = vec4(c.rgb * lift * vig, c.a);
}
