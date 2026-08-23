// passes.ts — the GLSL pass machinery the compositor draws through: compiling a ScenePass into
// a program, the ping-pong pair of framebuffers a chain of passes bounces between, and the
// uniforms every shader is handed. Split out because compositor.ts is the LAYOUT — which quad
// goes where — and this is the part that runs somebody else's code.
// Full rationale: @studio/song's docs/shaders.md, and docs/passes.md here.

import type { ScenePass } from "./scene";

/**
 * The uniforms a shader may rely on being there, whatever it does with them.
 *
 * A CONTRACT rather than a convenience: a shader is authored against this list and nothing tells
 * its author they got a name wrong — GL silently returns a null location for an unknown uniform,
 * and for one that is merely UNUSED too, so the two are indistinguishable from here. Writing the
 * list down is the only place that difference can be documented.
 *
 * `uTex` is what the pass reads: the layer's frame for the first pass in a chain, and the previous
 * pass's output after that. That is the whole of what makes them chain.
 */
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

/** The unit quad every pass draws, in the attribute `aUnit` — the same two triangles the
 *  compositor's own program uses, because a pass covers its whole target. */
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

/** One compiled pass: its program and the uniform locations, looked up once. A location may be
 *  null and that is normal — a shader that ignores `uP3` has no `uP3`, and setting a null location
 *  is a no-op in WebGL rather than an error. */
export interface PassProgram {
  id: string;
  prog: WebGLProgram;
  loc: Partial<
    Record<(typeof PASS_UNIFORMS)[number], WebGLUniformLocation | null>
  >;
}

/**
 * Compile one pass, or null when its GLSL will not build.
 *
 * Null and a console line, rather than a throw: a shader is source somebody is EDITING, and a
 * half-typed fragment must not take the viewport down with it. The layer then draws as if the
 * pass were not there, which is the same posture the whole picture path takes to a missing shader
 * folder — you lose the effect and keep the frame.
 *
 * The message names the NODE (`glow`), not the file, because the node is what is on screen and
 * what you would click to fix it.
 */
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
    // The attribute is bound BEFORE linking, to location 0, so every pass shares the one vertex
    // buffer the compositor already set up. Without this a shader that declares its attributes in
    // another order would read the quad off whichever slot the linker happened to pick.
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
    // Deleted once attached (or once failed): the program keeps them alive until IT is deleted,
    // which is what stops a scene rebuild leaking a shader object per pass per rebuild.
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
  }
}

/** Hand a compiled pass its uniforms and draw the quad. The texture must already be bound to
 *  TEXTURE0 — the caller owns which one, since that is the whole difference between the first
 *  pass in a chain and the rest. */
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

/** Allocate an offscreen RGBA target at `w`×`h` with the sampling every pass wants. Shared by
 *  `RenderTarget` and `PingPong` so the two cannot end up with different filtering — which shows
 *  up as a frame shader softening the picture and a layer shader not. */
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
  // CLAMP_TO_EDGE, and it matters more here than on a video texture: a shader sampling past the
  // edge (every blur, every displacement) would otherwise wrap the far side of the frame into the
  // near one, which reads as a bug in the shader rather than in its target.
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

/**
 * One offscreen target: where the layers COMPOSITE when the frame itself is going to be shaded.
 *
 * Its own thing rather than half of the ping-pong, and the separation is the correction of a real
 * mistake: sharing the pair meant a layer's chain cleared the target the composite so far was
 * accumulating into, so every layer but the last vanished the moment any layer grew a shader.
 * The composite ACCUMULATES over a whole frame; a chain's scratch is cleared per pass. Two
 * lifetimes, two resources.
 */
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

  /** Point rendering here. `clear` is false for every draw after the first in one frame, which is
   *  what makes this accumulate rather than keep only the topmost layer. */
  bind(clear: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    if (!clear) return;
    // Transparent black, not the scene's background: a frame shader must be handed PICTURE, and
    // clearing to the background would have it shading the backdrop as though it were one.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}

/**
 * A pair of offscreen targets a chain of passes bounces between.
 *
 * Two and not one, because a shader cannot read the texture it is writing: sampling and rendering
 * the same attachment is undefined in GL and looks, in practice, like the effect working on one
 * machine and tearing on another. So pass N reads `a` and writes `b`, then they swap.
 *
 * Allocated at the VIEWPORT's size rather than the layer's rect: a pass may sample outside the
 * fragment it is writing (a blur does), and a target cropped to the layer would give it the edge
 * of the crop instead of the picture. Costs two full-frame RGBA textures per chain, once.
 */
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

  /** Point rendering at the back target and clear it. Transparent black, not the scene's
   *  background: a layer's own passes run BEFORE compositing, so anything the shader does not
   *  write must stay see-through or the layer would blot out everything under it. */
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
