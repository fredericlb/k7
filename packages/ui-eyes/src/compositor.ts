// compositor.ts — the viewport in WebGL2: one texture per layer, one textured quad each,
// composited bottom-first. The ONE renderer both drivers share, because texImage2D takes an
// HTMLVideoElement and a VideoFrame identically — so it never learns which driver owns it.
// It OWNS its canvas (a React-owned one races two GL contexts). A layer may carry GLSL passes
// and so may the finished frame: passes.ts runs those, docs/passes.md is the page.

import {
  compilePass,
  compileTransition,
  drawPass,
  drawTransition,
  type PassProgram,
  PingPong,
  RenderTarget,
  type TransitionProgram,
} from "./passes";
import type { ScenePass, SceneShape, VideoScene } from "./scene";
import { builtinDissolve, DISSOLVE } from "./transitions";

/** What a layer is blending this frame: which program, how far, and which of the two slots carry a picture. */
// The slots are stated rather than inferred: `hasFrame` never resets, so it cannot answer "this frame".
export interface LayerBlend {
  name: string;
  progress: number;
  from: boolean; // slot 0 holds the outgoing picture
  to: boolean; // slot 1 holds the incoming one
}

const VERT = `#version 300 es
in vec2 aUnit;                 // a unit quad, (0,0)..(1,1)
uniform vec4 uRect;            // target rect in clip space: (x0, y0, x1, y1)
out vec2 vUV;
void main() {
  vUV = vec2(aUnit.x, aUnit.y);
  vec2 p = mix(uRect.xy, uRect.zw, aUnit);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uUV;              // (scaleX, scaleY, offsetX, offsetY) — see coverUV
out vec4 outColor;
void main() { outColor = texture(uTex, vUV * uUV.xy + uUV.zw); }`;

/** No transform: sample the texture over its whole face, which is what a rect-shaped one wants. */
export const UV_FILL: readonly [number, number, number, number] = [1, 1, 0, 0];

/**
 * The UV transform that fills a `dstAR` rect with a `srcAR` picture WITHOUT distorting it: the
 * overflow is cropped, evenly on both sides. A webcam is 4:3 or 16:9 and the frame it lands in is
 * whatever the project says — sampling the whole texture over the whole rect stretches one into
 * the other, which is the distortion this exists to remove.
 *
 * COVER rather than contain: a lane fills its rect. Letterboxing inside a layer would put bars in
 * the middle of a composite, where nothing can paint over them; the FRAME's own bars are the
 * viewport's business, not a layer's.
 *
 * Identity when either aspect is unknown — a source that has not said its size yet must draw
 * undistorted-or-not rather than not at all.
 */
export function coverUV(
  srcAR: number,
  dstAR: number,
): [number, number, number, number] {
  if (!(srcAR > 0) || !(dstAR > 0) || srcAR === dstAR) return [1, 1, 0, 0];
  const wide = srcAR > dstAR;
  const sx = wide ? dstAR / srcAR : 1;
  const sy = wide ? 1 : srcAR / dstAR;
  return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
}

/** What a frame source is shaped like, or 0 when it will not say — see `upload`. */
export function sourceAR(src: TexImageSource): number {
  const v = src as Partial<HTMLVideoElement> &
    Partial<VideoFrame> & { width?: number; height?: number };
  const w = v.videoWidth || v.displayWidth || v.width || 0;
  const h = v.videoHeight || v.displayHeight || v.height || 0;
  return w > 0 && h > 0 ? w / h : 0;
}

interface LayerGL {
  id: string;
  tex: WebGLTexture;
  // The SECOND picture, only on a lane that dissolves: a lane that never does allocates nothing.
  tex2: WebGLTexture | null;
  rect: [number, number, number, number]; // clip space, precomputed from the viewport
  /** The rect's own aspect in PIXELS, and the SOURCE's as the last upload reported it (0 = not
   *  said yet). The two together are the UV transform that keeps a picture from stretching. */
  dstAR: number;
  srcAR: number;
  hasFrame: boolean; // nothing uploaded yet -> don't draw (avoids a black or garbage quad)
  // This layer's passes and their programs, index for index; a null program did not build and is stepped over.
  passes: ScenePass[];
  programs: (PassProgram | null)[];
}

/** Does this lane ever need two pictures at once? Only a `fade_in` does — a fade_out goes to nothing. */
const dissolves = (clips: readonly { fadeIn?: unknown }[]): boolean =>
  clips.some((c) => c.fadeIn);

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(`eyes: shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

// The viewport has a top-left origin, clip space is bottom-left: map a viewport-px rect to clip space, flipping y.
function rectToClip(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): [number, number, number, number] {
  const x0 = (x / vw) * 2 - 1;
  const x1 = ((x + w) / vw) * 2 - 1;
  const y0 = 1 - (y / vh) * 2; // top edge
  const y1 = 1 - ((y + h) / vh) * 2; // bottom edge
  return [x0, y1, x1, y0]; // (x0,y0)=bottom-left, (x1,y1)=top-right for the unit-quad lerp
}

// One picture slot: a texture with the filtering every layer's uploads share, allocated lazily on first upload.
function makeSlot(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// Rasterize a shape layer to a 2D canvas at viewport resolution, once per scene — see docs/compositor.md.
function rasterizeShapes(
  shapes: SceneShape[],
  vw: number,
  vh: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(vw, vh);
  const ctx = canvas.getContext("2d")!;
  for (const s of shapes) {
    ctx.fillStyle = s.color;
    if (s.type === "square") {
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (s.type === "circle") {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = `${s.fontSize}px ${s.font}`;
      ctx.textBaseline = "top";
      // `w` is a MAX width: Canvas condenses the glyphs to fit rather than wrapping (single-line text for v1).
      if (s.w != null) ctx.fillText(s.content, s.x, s.y, s.w);
      else ctx.fillText(s.content, s.x, s.y);
    }
  }
  return canvas;
}

function readClearColor(el: HTMLElement): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue("--sh-background").trim();
  const n = v.startsWith("#") ? parseInt(v.slice(1), 16) : NaN;
  if (Number.isNaN(n)) return [0.06, 0.07, 0.08]; // matches the token's dark default
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uRect: WebGLUniformLocation;
  private uUV: WebGLUniformLocation;
  private layers: LayerGL[] = [];
  private clear: [number, number, number];
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  // The scratch a chain bounces through and, only when the FRAME is shaded, the composite target — see docs/passes.md.
  private pingpong: PingPong | null = null;
  private frameTarget: RenderTarget | null = null;
  private framePasses: ScenePass[] = [];
  private framePrograms: (PassProgram | null)[] = [];
  // One program per NAMED transition, plus the built-in dissolve; a name with no program falls back to it.
  private transitions = new Map<string, TransitionProgram | null>();
  // A 1×1 transparent texel: what a fade goes TO when nothing follows, so GLSL needs no branch.
  private empty: WebGLTexture;
  private warned = new Set<string>();
  // What `uTime` is handed: the transport's position, pushed by the host rather than measured here — see docs/passes.md.
  private timeSec = 0;

  private constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    gl: WebGL2RenderingContext,
    clear: [number, number, number],
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.clear = clear;

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

    // One unit quad, shared by every layer (the per-layer rect is a uniform).
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // two triangles over (0,0)..(1,1)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aUnit = gl.getAttribLocation(prog, "aUnit");
    gl.enableVertexAttribArray(aUnit);
    gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);

    // Video frames arrive top-down; GL textures are bottom-up. Flip on upload so the texcoords stay the obvious 0..1.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Straight-alpha over, so a shape's background_color can blend; video textures are opaque, so it is a no-op there.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.empty = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // The compositor makes its own canvas, except for export which hands it one; the backing store is always the viewport's pixel size.
  static create(
    target: HTMLElement | OffscreenCanvas,
    scene: VideoScene,
  ): Compositor {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let clear: [number, number, number];
    if (target instanceof OffscreenCanvas) {
      canvas = target;
      // TRUE black for a render: the preview's background token is chrome, and a fade-out that
      // landed on it would bake the app's grey into the file — docs/transitions.md.
      clear = [0, 0, 0];
    } else {
      const c = document.createElement("canvas");
      c.style.display = "block";
      c.style.width = "100%";
      c.style.height = "100%";
      target.appendChild(c);
      canvas = c;
      clear = readClearColor(target);
    }
    canvas.width = scene.viewport[0];
    canvas.height = scene.viewport[1];
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // export reads pixels back after draw
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("eyes: WebGL2 is not available");
    const comp = new Compositor(canvas, gl, clear);
    comp.setScene(scene);
    return comp;
  }

  // (Re)build the per-layer textures and quads. Textures allocate lazily on first upload; this reserves the slots.
  setScene(scene: VideoScene): void {
    const gl = this.gl;
    for (const l of this.layers) {
      gl.deleteTexture(l.tex);
      if (l.tex2) gl.deleteTexture(l.tex2);
      for (const p of l.programs) if (p) gl.deleteProgram(p.prog);
    }
    for (const p of this.framePrograms) if (p) gl.deleteProgram(p.prog);
    for (const t of this.transitions.values()) if (t) gl.deleteProgram(t.prog);
    this.canvas.width = scene.viewport[0];
    this.canvas.height = scene.viewport[1];
    const [vw, vh] = scene.viewport;

    // One program per name the cuts use, the built-in FIRST so a module of that name overrides it.
    this.transitions = new Map();
    this.warned.clear();
    for (const t of [
      builtinDissolve(),
      ...Object.values(scene.transitions ?? {}),
    ])
      this.transitions.set(t.name, compileTransition(gl, t));

    // The offscreen targets: rebuilt only when the viewport changed, dropped when nothing needs them — see docs/passes.md.
    this.framePasses = scene.framePasses ?? [];
    // A fade runs its program full-target through the scratch, so a song that dissolves needs one too.
    const wantsScratch =
      scene.layers.some(
        (l) => l.passes?.length || l.clips.some((c) => c.fadeIn || c.fadeOut),
      ) || this.framePasses.length > 0;
    const sized = (t: { width: number; height: number } | null) =>
      !!t && t.width === vw && t.height === vh;

    if (this.pingpong && (!wantsScratch || !sized(this.pingpong))) {
      this.pingpong.destroy();
      this.pingpong = null;
    }
    if (wantsScratch && !this.pingpong)
      this.pingpong = new PingPong(gl, vw, vh);

    // The composite target exists ONLY when the frame itself is shaded; otherwise the layers go straight to the canvas.
    const wantsFrameTarget = this.framePasses.length > 0;
    if (this.frameTarget && (!wantsFrameTarget || !sized(this.frameTarget))) {
      this.frameTarget.destroy();
      this.frameTarget = null;
    }
    if (wantsFrameTarget && !this.frameTarget)
      this.frameTarget = new RenderTarget(gl, vw, vh);

    this.framePrograms = this.framePasses.map((p) => compilePass(gl, p));

    this.layers = scene.layers.map((l) => {
      const tex = makeSlot(gl);
      // A SHAPE layer rasterizes and uploads now; a video layer's texture stays empty, and skipped, until its first frame.
      if (l.shapes?.length) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          rasterizeShapes(l.shapes, vw, vh),
        );
        return {
          id: l.id,
          tex,
          tex2: null, // a shape lane holds no clips, so it never dissolves
          rect: rectToClip(0, 0, vw, vh, vw, vh),
          dstAR: vh > 0 ? vw / vh : 0,
          // A shape lane is RASTERISED at viewport size, so it already fits: nothing to correct.
          srcAR: vh > 0 ? vw / vh : 0,
          hasFrame: true,
          passes: l.passes ?? [],
          programs: (l.passes ?? []).map((p) => compilePass(gl, p)),
        };
      }
      return {
        id: l.id,
        tex,
        tex2: dissolves(l.clips) ? makeSlot(gl) : null,
        rect: rectToClip(l.x, l.y, l.w, l.h, vw, vh),
        dstAR: l.h > 0 ? l.w / l.h : 0,
        srcAR: 0, // said by the first upload, not by the document
        hasFrame: false,
        passes: l.passes ?? [],
        programs: (l.passes ?? []).map((p) => compilePass(gl, p)),
      };
    });
  }

  /** The live values a pass is handed, keyed on the pass id and refreshed between frames — see docs/passes.md. */
  setLive(
    timeSec: number,
    audioByPass?: Readonly<Record<string, number>>,
  ): void {
    this.timeSec = timeSec;
    if (!audioByPass) return;
    for (const l of this.layers)
      for (const p of l.passes) {
        const v = audioByPass[p.id];
        if (v !== undefined) p.audio = v;
      }
    for (const p of this.framePasses) {
      const v = audioByPass[p.id];
      if (v !== undefined) p.audio = v;
    }
  }

  /** Run a chain over the ping-pong's front texture, leaving the RESULT there and the framebuffer unbound. */
  private runPasses(
    passes: readonly ScenePass[],
    programs: readonly (PassProgram | null)[],
  ): void {
    const pp = this.pingpong;
    if (!pp) return;
    const gl = this.gl;
    const res: [number, number] = [pp.width, pp.height];
    for (let i = 0; i < passes.length; i++) {
      const prog = programs[i];
      if (!prog) continue; // did not compile — this pass is simply not in the chain
      pp.bindBack();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.frontTexture());
      // Blending OFF inside a chain: a pass REPLACES the picture it was handed — see docs/passes.md.
      gl.disable(gl.BLEND);
      drawPass(gl, prog, passes[i], res, this.timeSec);
      gl.enable(gl.BLEND);
      pp.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Run a transition into the bound target: two pictures in, one out, full-target like any pass. */
  // A side with no picture is the 1×1 transparent texel, which is what makes fade-to-nothing the same path.
  private seedBlend(layer: LayerGL, blend: LayerBlend): void {
    const gl = this.gl;
    const prog = this.transitionFor(blend.name);
    if (!prog) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blend.from ? layer.tex : this.empty);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      gl.TEXTURE_2D,
      blend.to && layer.tex2 ? layer.tex2 : this.empty,
    );
    gl.activeTexture(gl.TEXTURE0);
    drawTransition(
      gl,
      prog,
      blend.progress,
      [this.canvas.width, this.canvas.height],
      this.timeSec,
    );
  }

  /** Draw one textured quad of `tex` with the plain program, onto whatever is bound now. */
  private blit(
    tex: WebGLTexture,
    rect: [number, number, number, number],
    /** How to sample the texture — `UV_FILL` for one already shaped like the rect. */
    uv: readonly [number, number, number, number] = UV_FILL,
  ): void {
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform4fv(this.uRect, rect);
    gl.uniform4f(this.uUV, uv[0], uv[1], uv[2], uv[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Upload a frame from a <video> or a VideoFrame; cheap per rAF, and skippable when no new frame was produced.
  // Slot 1 is the SECOND picture of a dissolve, and only a lane that declares one has it.
  upload(layerId: string, src: TexImageSource, slot: 0 | 1 = 0): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const tex = slot === 1 ? layer.tex2 : layer.tex;
    if (!tex) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    // Learned HERE and not from the document: a camera's shape is the machine's, and a file's is
    // the file's — neither is anything the project could have said (docs/compositor.md).
    const ar = sourceAR(src);
    if (ar > 0) layer.srcAR = ar;
    if (slot === 0) layer.hasFrame = true;
  }

  /** The program for a name, falling back to the built-in dissolve and saying so ONCE — docs/transitions.md. */
  // Falling back rather than dropping the fade: dropping it would move the CUT, which is the arrangement.
  private transitionFor(name: string): TransitionProgram | null {
    const hit = this.transitions.get(name);
    if (hit) return hit;
    if (!this.warned.has(name)) {
      this.warned.add(name);
      console.warn(
        `eyes: no transition '${name}' — falling back to a dissolve`,
      );
    }
    return this.transitions.get(DISSOLVE) ?? null;
  }

  /** Draw every visible layer bottom-first, skipping one with no frame yet; three shapes, see docs/passes.md. */
  // `blends` says which layers are mid-transition this frame — absent is every frame that is a cut.
  draw(visible: Set<string>, blends?: ReadonlyMap<string, LayerBlend>): void {
    const gl = this.gl;
    const pp = this.pingpong;
    const target = this.framePasses.length ? this.frameTarget : null;

    // Where the layers composite: the offscreen target when the frame is shaded, else the canvas.
    let first = true;
    const bindComposite = () => {
      if (target) {
        target.bind(first);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        if (first) {
          gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      }
      first = false;
    };
    bindComposite();

    for (const layer of this.layers) {
      if (!visible.has(layer.id)) continue;
      const blend = blends?.get(layer.id);
      // A blending layer needs no `hasFrame`: the blend says which slots carry a picture THIS frame.
      if (!blend && !layer.hasFrame) continue;

      if (pp && (blend || layer.passes.length)) {
        // The layer's frame seeds the chain full-viewport, so a pass sampling its neighbourhood has the whole picture.
        pp.bindBack();
        gl.disable(gl.BLEND);
        if (blend) this.seedBlend(layer, blend);
        else
          this.blit(
            layer.tex,
            [-1, -1, 1, 1],
            coverUV(layer.srcAR, layer.dstAR),
          );
        gl.enable(gl.BLEND);
        pp.swap();
        // The transition runs BEFORE the lane's own chain: an effect characterises the lane, so it
        // sees the picture the lane is showing rather than crossfading two of its own outputs.
        this.runPasses(layer.passes, layer.programs);
        bindComposite();
        // A blended result carries meaningful alpha and is PREMULTIPLIED; an ordinary pass's is straight.
        if (blend) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.blit(pp.frontTexture(), layer.rect);
        if (blend) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        continue;
      }
      bindComposite();
      this.blit(layer.tex, layer.rect, coverUV(layer.srcAR, layer.dstAR));
    }

    if (!target || !pp) return;
    // Now shade the whole composite: seeded into the scratch rather than shaded in place, for the reason PingPong exists.
    pp.bindBack();
    gl.disable(gl.BLEND);
    this.blit(target.texture, [-1, -1, 1, 1]);
    gl.enable(gl.BLEND);
    pp.swap();
    this.runPasses(this.framePasses, this.framePrograms);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.blit(pp.frontTexture(), [-1, -1, 1, 1]);
  }

  // Set the DISPLAY size only: the backing store stays the viewport's, so the model is resolution-independent.
  resize(cssW: number, cssH: number): void {
    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
  }

  destroy(): void {
    const gl = this.gl;
    for (const l of this.layers) {
      gl.deleteTexture(l.tex);
      if (l.tex2) gl.deleteTexture(l.tex2);
      for (const p of l.programs) if (p) gl.deleteProgram(p.prog);
    }
    this.layers = [];
    for (const p of this.framePrograms) if (p) gl.deleteProgram(p.prog);
    this.framePrograms = [];
    for (const t of this.transitions.values()) if (t) gl.deleteProgram(t.prog);
    this.transitions.clear();
    gl.deleteTexture(this.empty);
    this.pingpong?.destroy();
    this.pingpong = null;
    this.frameTarget?.destroy();
    this.frameTarget = null;
    gl.deleteProgram(this.prog);
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}
