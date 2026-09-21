#version 300 es
// The same full-target quad "pulse" uses — see the note in its vertex.glsl for why each shader
// carries its own copy rather than sharing one.
in vec2 aUnit;
out vec2 vUV;

void main() {
  vUV = aUnit;
  gl_Position = vec4(aUnit * 2.0 - 1.0, 0.0, 1.0);
}
