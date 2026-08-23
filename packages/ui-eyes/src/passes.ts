// passes.ts — the GLSL pass machinery the compositor draws through: compiling a ScenePass into
// a program, the ping-pong pair of framebuffers a chain of passes bounces between, and the
// uniforms every shader is handed. Split out because compositor.ts is the LAYOUT — which quad
// goes where — and this is the part that runs somebody else's code.
// Full rationale: @studio/song's docs/shaders.md, and docs/passes.md here.

import type { ScenePass } from "./scene";

/** The uniforms a shader may rely on — a CONTRACT, since GL cannot tell an unknown name from an unused one. See docs/passes.md. */
export const PASS_UNIFORMS = [
  "uTex", // sampler2D — the picture coming in
  "uAudio", // float 0..1 — the live level of the lane wired to the audio port, 0 with none
  "uTime", // float seconds — the transport's position, so an effect can move with the song
  "uResolution", // vec2 px — the viewport, for anything working in pixels rather than in UV
  "uP1",
  "uP2",
  "uP3",
  "uP4",
] as const;

/** The unit quad every pass draws, in the attribute `aUnit` — the same two triangles the compositor's own program uses. */
export const PASS_ATTRIB = "aUnit";

function compileStage(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  what: string,
): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${what}: ${log}`);
  }
  return sh;
}

/** One compiled pass: its program and the uniform locations, looked up once; a null location is normal, and setting one a no-op. */
export interface PassProgram {
  id: string;
  prog: WebGLProgram;
  loc: Partial<
    Record<(typeof PASS_UNIFORMS)[number], WebGLUniformLocation | null>
  >;
}

/** Compile one pass, or null and a console line naming the NODE when its GLSL will not build — see docs/passes.md. */
export function compilePass(
  gl: WebGL2RenderingContext,
  pass: ScenePass,
): PassProgram | null {
  let vert: WebGLShader | null = null;
  let frag: WebGLShader | null = null;
  try {
    vert = compileStage(
      gl,
      gl.VERTEX_SHADER,
      pass.vertex,
      `eyes: '${pass.name}' vertex.glsl`,
    );
    frag = compileStage(
      gl,
      gl.FRAGMENT_SHADER,
      pass.fragment,
      `eyes: '${pass.name}' fragment.glsl`,
    );
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    // Bound to location 0 BEFORE linking, so every pass shares the compositor's one vertex buffer — see docs/passes.md.
    gl.bindAttribLocation(prog, 0, PASS_ATTRIB);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`eyes: '${pass.name}' link failed: ${log}`);
    }
    const loc: PassProgram["loc"] = {};
    for (const u of PASS_UNIFORMS) loc[u] = gl.getUniformLocation(prog, u);
    return { id: pass.id, prog, loc };
  } catch (e) {
    console.warn((e as Error).message);
    return null;
  } finally {
    // Deleted once attached: the program keeps them alive, which stops a scene rebuild leaking a shader object per pass.
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
  }
}

/** Hand a compiled pass its uniforms and draw the quad; the caller owns which texture is bound to TEXTURE0. */
export function drawPass(
  gl: WebGL2RenderingContext,
  p: PassProgram,
  pass: ScenePass,
  resolution: [number, number],
  timeSec: number,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
  gl.useProgram(p.prog);
  if (p.loc.uTex != null) gl.uniform1i(p.loc.uTex, 0);
  if (p.loc.uAudio != null) gl.uniform1f(p.loc.uAudio, pass.audio);
  if (p.loc.uTime != null) gl.uniform1f(p.loc.uTime, timeSec);
  if (p.loc.uResolution != null)
    gl.uniform2f(p.loc.uResolution, resolution[0], resolution[1]);
  for (const k of ["uP1", "uP2", "uP3", "uP4"] as const)
    if (p.loc[k] != null) gl.uniform1f(p.loc[k], pass.params[k.slice(1)] ?? 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/** Allocate an offscreen RGBA target at `w`×`h`, shared by `RenderTarget` and `PingPong` so their filtering cannot diverge. */
function makeTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
): [WebGLFramebuffer, WebGLTexture] {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // CLAMP_TO_EDGE matters more here than on a video texture: a shader sampling past the edge must not wrap — see docs/passes.md.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return [fbo, tex];
}

/** One offscreen target: where the layers COMPOSITE when the frame itself will be shaded — its own thing, see docs/passes.md. */
export class RenderTarget {
  private gl: WebGL2RenderingContext;
  private fbo: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const [fbo, tex] = makeTarget(gl, width, height);
    this.fbo = fbo;
    this.texture = tex;
  }

  /** Point rendering here. `clear` is false after the first draw of a frame, which is what makes this accumulate. */
  bind(clear: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    if (!clear) return;
    // Transparent black, not the scene's background: a frame shader must be handed PICTURE — see docs/passes.md.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}

/** A pair of offscreen targets a chain bounces between, at the VIEWPORT's size — two, not one, see docs/passes.md. */
export class PingPong {
  private gl: WebGL2RenderingContext;
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private tex: [WebGLTexture, WebGLTexture];
  private front = 0;
  readonly width: number;
  readonly height: number;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const [f0, t0] = makeTarget(gl, width, height);
    const [f1, t1] = makeTarget(gl, width, height);
    this.fbo = [f0, f1];
    this.tex = [t0, t1];
  }

  /** Point rendering at the back target and clear it to transparent black, never the scene's background. */
  bindBack(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.front]);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** The texture holding the most recently FINISHED result — what the next pass samples. */
  frontTexture(): WebGLTexture {
    return this.tex[this.front];
  }

  /** …and the swap that makes what was just written the new front. */
  swap(): void {
    this.front = 1 - this.front;
  }

  destroy(): void {
    const gl = this.gl;
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    for (const t of this.tex) gl.deleteTexture(t);
  }
}
