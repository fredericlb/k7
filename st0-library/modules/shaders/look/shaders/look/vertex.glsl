#version 300 es
// The full-target vertex stage every pass uses: the unit quad onto clip space, its 0..1 as the UV.
in vec2 aUnit;
out vec2 vUV;

void main() {
  vUV = aUnit;
  gl_Position = vec4(aUnit * 2.0 - 1.0, 0.0, 1.0);
}
