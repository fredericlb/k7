// plain.ts — the one program that draws a texture as a quad: every layer, every seed of a chain,
// every copy between targets. A rect places the quad, an affine moves it (a shot's motion, the
// identity otherwise) and an opacity fades it, premultiplied or not depending on what reads the
// result next. See docs/compositor.md and docs/motion.md.

import { type Affine, IDENTITY } from "./motion";

const VERT = `#version 300 es
in vec2 aUnit;                 // a unit quad, (0,0)..(1,1)
uniform vec4 uRect;            // target rect in clip space: (x0, y0, x1, y1)
uniform mat3 uXf;              // then moved in clip space — a shot's motion, else the identity
out vec2 vUV;
void main() {
  vUV = vec2(aUnit.x, aUnit.y);
  vec2 p = mix(uRect.xy, uRect.zw, aUnit);
  gl_Position = vec4((uXf * vec3(p, 1.0)).xy, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uUV;              // (scaleX, scaleY, offsetX, offsetY) — see coverUV
uniform vec2 uAlpha;           // (opacity, 1 when the result is read PREMULTIPLIED)
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV * uUV.xy + uUV.zw);
  outColor = vec4(c.rgb * mix(1.0, uAlpha.x, uAlpha.y), c.a * uAlpha.x);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(`eyes: shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

/** How one quad is drawn beyond its rect: moved, faded, and whether whoever reads it expects premultiplied alpha. */
export interface QuadLook {
  xf?: Affine;
  alpha?: number;
  premultiplied?: boolean;
}

export class PlainProgram {
  readonly prog: WebGLProgram;
  private gl: WebGL2RenderingContext;
  private uRect: WebGLUniformLocation;
  private uUV: WebGLUniformLocation;
  private uXf: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(
        `eyes: program link failed: ${gl.getProgramInfoLog(prog)}`,
      );
    this.prog = prog;
    this.uRect = gl.getUniformLocation(prog, "uRect")!;
    this.uUV = gl.getUniformLocation(prog, "uUV")!;
    this.uXf = gl.getUniformLocation(prog, "uXf")!;
    this.uAlpha = gl.getUniformLocation(prog, "uAlpha")!;
    // The one unit quad every draw shares: two triangles over (0,0)..(1,1).
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aUnit = gl.getAttribLocation(prog, "aUnit");
    gl.enableVertexAttribArray(aUnit);
    gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
  }

  /** Draw one textured quad of `tex` onto whatever is bound now. */
  draw(
    tex: WebGLTexture,
    rect: readonly [number, number, number, number],
    uv: readonly [number, number, number, number],
    look: QuadLook = {},
  ): void {
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform4fv(this.uRect, rect);
    gl.uniform4f(this.uUV, uv[0], uv[1], uv[2], uv[3]);
    gl.uniformMatrix3fv(this.uXf, false, look.xf ?? IDENTITY);
    gl.uniform2f(this.uAlpha, look.alpha ?? 1, look.premultiplied ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
