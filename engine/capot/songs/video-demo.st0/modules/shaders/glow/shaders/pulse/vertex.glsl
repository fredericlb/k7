#version 300 es
// The vertex stage every full-target pass wants: `aUnit` is the unit quad the compositor binds,
// and a pass covers the whole of what it draws into — so this maps (0,0)..(1,1) onto clip space
// and hands the fragment the same 0..1 as its texture coordinate.
//
// It is a separate file, and duplicated per shader on purpose: a shader is the PAIR, and the day
// one wants to move its geometry it needs this file to itself rather than a shared one it would
// have to fork. See packages/song/docs/shaders.md.
in vec2 aUnit;
out vec2 vUV;

void main() {
  vUV = aUnit;
  gl_Position = vec4(aUnit * 2.0 - 1.0, 0.0, 1.0);
}
