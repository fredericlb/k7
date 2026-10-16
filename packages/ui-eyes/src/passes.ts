// passes.ts — the GLSL pass machinery the compositor draws through: compiling a ScenePass into
// a program, the ping-pong pair of framebuffers a chain of passes bounces between, and the
// uniforms every shader is handed. Split out because compositor.ts is the LAYOUT — which quad
// goes where — and this is the part that runs somebody else's code.
// Full rationale: @studio/song's docs/shaders.md, and docs/passes.md here.

import {
  SHADER_PARAMS,
  shaderUniformFor,
} from "@studio/song-schema/moduleTypes";
import type { ScenePass, SceneTransition } from "./scene";

/** Each numbered knob beside the uniform it lands on, from song-schema's one rule. */
const PARAM_UNIFORMS = SHADER_PARAMS.map(
  (p) => [p, shaderUniformFor(p)] as const,
);

/** The uniforms a shader may rely on — a CONTRACT, since GL cannot tell an unknown name from an unused one. See docs/passes.md. */
const PASS_UNIFORMS = [
  "uTex", // sampler2D — the picture coming in
  "uAudio", // float 0..1 — the live level of the lane wired to the audio port, 0 with none
  "uTime", // float seconds — the transport's position, so an effect can move with the song
  "uResolution", // vec2 px — the viewport, for anything working in pixels rather than in UV
  "uPresence", // float 0..1 — how much of the shot is on screen: rises over a stretch's fade-in, falls over its fade-out, 1 elsewhere
  ...PARAM_UNIFORMS.map(([, u]) => u), // float 0..1 each — the module's four numbered knobs
  "uLut", // sampler3D — the node's `.cube` LUT, on unit 2; read only when uLutSize is above 0
  "uLutSize", // float — the LUT's edge, 0 while it loads or when the node names none (docs/luts.md)
];

/** The uniforms a TRANSITION may rely on — its OWN contract, two inputs being a different shape. */
// Deliberately not `uTex`: a shader fragment pasted in here fails loudly instead of sampling nothing.
const TRANSITION_UNIFORMS = [
  "uFrom", // sampler2D — the picture on its way OUT; a transparent texel when there is none
  "uTo", // sampler2D — …and the one coming in; transparent for a fade-out
  "uProgress", // float 0..1 — 0 is uFrom alone, 1 is uTo alone
  "uTime", // float seconds — the transport's position, as everywhere else
  "uResolution", // vec2 px — the viewport
  ...PARAM_UNIFORMS.map(([, u]) => u), // the four knobs, as for a pass
];

/** The unit quad every pass draws, in the attribute `aUnit` — the same two triangles the compositor's own program uses. */
const PASS_ATTRIB = "aUnit";

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
  loc: Partial<Record<string, WebGLUniformLocation | null>>;
}

/** …and one compiled transition, keyed by NAME since one program serves every cut that names it. */
export interface TransitionProgram {
  name: string;
  prog: WebGLProgram;
  loc: Partial<Record<string, WebGLUniformLocation | null>>;
  params: Record<string, number>; // the module's four knobs, fixed for the scene
}

// Compile and link one program, looking up `uniforms`; null and a console line naming the NODE on failure.
function linkProgram(
  gl: WebGL2RenderingContext,
  name: string,
  vertex: string,
  fragment: string,
  uniforms: readonly string[],
): {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
} | null {
  let vert: WebGLShader | null = null;
  let frag: WebGLShader | null = null;
  try {
    vert = compileStage(
      gl,
      gl.VERTEX_SHADER,
      vertex,
      `eyes: '${name}' vertex.glsl`,
    );
    frag = compileStage(
      gl,
      gl.FRAGMENT_SHADER,
      fragment,
      `eyes: '${name}' fragment.glsl`,
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
      throw new Error(`eyes: '${name}' link failed: ${log}`);
    }
    const loc: Record<string, WebGLUniformLocation | null> = {};
    for (const u of uniforms) loc[u] = gl.getUniformLocation(prog, u);
    return { prog, loc };
  } catch (e) {
    console.warn((e as Error).message);
    return null;
  } finally {
    // Deleted once attached: the program keeps them alive, which stops a scene rebuild leaking a shader object per pass.
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
  }
}

/** Compile one pass, or null and a console line naming the NODE when its GLSL will not build — see docs/passes.md. */
export function compilePass(
  gl: WebGL2RenderingContext,
  pass: ScenePass,
): PassProgram | null {
  const built = linkProgram(
    gl,
    pass.name,
    pass.vertex,
    pass.fragment,
    PASS_UNIFORMS,
  );
  return built ? { id: pass.id, prog: built.prog, loc: built.loc } : null;
}

/** …and one TRANSITION, over the other contract. Same failure posture: the picture survives its GLSL. */
export function compileTransition(
  gl: WebGL2RenderingContext,
  t: SceneTransition,
): TransitionProgram | null {
  const built = linkProgram(
    gl,
    t.name,
    t.vertex,
    t.fragment,
    TRANSITION_UNIFORMS,
  );
  return built
    ? { name: t.name, prog: built.prog, loc: built.loc, params: t.params }
    : null;
}

/** Hand a compiled pass its uniforms and draw the quad; the caller owns which texture is bound to TEXTURE0. */
export function drawPass(
  gl: WebGL2RenderingContext,
  p: PassProgram,
  pass: ScenePass,
  resolution: [number, number],
  timeSec: number,
  /** 1 outside a stretch, so a stretch's module run as an ordinary lane effect is the shot whole. */
  presence = 1,
  /** The pass's LUT once it is on the GPU; absent, `uLutSize` is 0 and the shader lets its picture through. */
  lut?: { tex: WebGLTexture; size: number } | null,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
  gl.useProgram(p.prog);
  if (p.loc.uTex != null) gl.uniform1i(p.loc.uTex, 0);
  if (p.loc.uPresence != null) gl.uniform1f(p.loc.uPresence, presence);
  if (p.loc.uAudio != null) gl.uniform1f(p.loc.uAudio, pass.audio);
  if (p.loc.uTime != null) gl.uniform1f(p.loc.uTime, timeSec);
  if (p.loc.uResolution != null)
    gl.uniform2f(p.loc.uResolution, resolution[0], resolution[1]);
  for (const [k, u] of PARAM_UNIFORMS)
    if (p.loc[u] != null) gl.uniform1f(p.loc[u], pass.params[k] ?? 0);
  if (p.loc.uLutSize != null) gl.uniform1f(p.loc.uLutSize, lut ? lut.size : 0);
  if (lut && p.loc.uLut != null) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lut.tex);
    gl.uniform1i(p.loc.uLut, 2);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/** Hand a transition its uniforms and draw the quad; the caller owns TEXTURE0 (`uFrom`) and TEXTURE1 (`uTo`). */
export function drawTransition(
  gl: WebGL2RenderingContext,
  p: TransitionProgram,
  progress: number,
  resolution: [number, number],
  timeSec: number,
): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
  gl.useProgram(p.prog);
  if (p.loc.uFrom != null) gl.uniform1i(p.loc.uFrom, 0);
  if (p.loc.uTo != null) gl.uniform1i(p.loc.uTo, 1);
  if (p.loc.uProgress != null) gl.uniform1f(p.loc.uProgress, progress);
  if (p.loc.uTime != null) gl.uniform1f(p.loc.uTime, timeSec);
  if (p.loc.uResolution != null)
    gl.uniform2f(p.loc.uResolution, resolution[0], resolution[1]);
  for (const [k, u] of PARAM_UNIFORMS)
    if (p.loc[u] != null) gl.uniform1f(p.loc[u], p.params[k] ?? 0);
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
