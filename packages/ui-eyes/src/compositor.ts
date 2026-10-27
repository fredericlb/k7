// compositor.ts — the viewport in WebGL2: one texture per layer, one textured quad each,
// composited bottom-first. The ONE renderer both drivers share, because texImage2D takes an
// HTMLVideoElement and a VideoFrame identically — so it never learns which driver owns it.
// It OWNS its canvas (a React-owned one races two GL contexts). A layer may carry GLSL passes
// and so may the finished frame: passes.ts runs those, docs/passes.md is the page.

import { isFullFrame, laneUV, rectToClip, sourceAR, UV_FILL } from "./geometry";
import { buildLayer, emptyTexel, type LayerGL } from "./layerGL";
import { Luts } from "./luts";
import { type Motion, motionAffine, scissorBox } from "./motion";
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
import { PlainProgram, type QuadLook } from "./plain";
import { isIdentityPass, type ScenePass, type VideoScene } from "./scene";
import { Sides } from "./slots";
import { Stretches } from "./stretches";
import type { SlotStretch } from "./timeline";
import { builtinDissolve, builtinOver, DISSOLVE } from "./transitions";

/** What a layer is blending this frame: which program, how far, and which of the two slots carry a picture. */
// The slots are stated rather than inferred: `hasFrame` never resets, so it cannot answer "this frame".
export interface LayerBlend {
  name: string;
  progress: number;
  from: boolean; // slot 0 holds the outgoing picture
  to: boolean; // slot 1 holds the incoming one
  // Each side's STRETCH this frame, run on its picture before the blend reads it — timeline.ts says which.
  stretch?: { from?: SlotStretch; to?: SlotStretch };
}

function readClearColor(el: HTMLElement): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue("--sh-background").trim();
  const n = v.startsWith("#") ? parseInt(v.slice(1), 16) : NaN;
  if (Number.isNaN(n)) return [0.06, 0.07, 0.08]; // matches the token's dark default
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  private gl: WebGL2RenderingContext;
  private plain: PlainProgram;
  // A slot's journey before the lane composites it — effect, motion, stretch — and the targets each needs (slots.ts).
  private sides: Sides;
  // Every `.cube` the passes read, on the GPU once each — luts.ts.
  private luts: Luts;
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
  // The runs a fade puts a shot through, and the two targets their results wait in — stretches.ts.
  private stretches: Stretches;
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
    this.stretches = new Stretches(gl);

    // The plain program, and the one unit quad every layer is drawn with (the per-layer rect is a uniform).
    this.plain = new PlainProgram(gl);

    // Video frames arrive top-down; GL textures are bottom-up. Flip on upload so the texcoords stay the obvious 0..1.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Straight-alpha over, so a shape's background_color can blend; video textures are opaque, so it is a no-op there.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.empty = emptyTexel(gl);
    this.luts = new Luts(gl);
    this.sides = new Sides({
      gl,
      blit: (tex, rect, uv, look) => this.blit(tex, rect, uv, look),
      runPasses: (passes, programs, presence) =>
        this.runPasses(passes, programs, presence),
      scratch: () => this.pingpong,
      stretches: this.stretches,
      empty: this.empty,
    });
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
      // Export reads the pixels back after the draw; the preview is only ever presented.
      preserveDrawingBuffer: target instanceof OffscreenCanvas,
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
    // Assigning a canvas size clears it even when unchanged, which would flash black on every edit.
    if (this.canvas.width !== scene.viewport[0])
      this.canvas.width = scene.viewport[0];
    if (this.canvas.height !== scene.viewport[1])
      this.canvas.height = scene.viewport[1];
    const [vw, vh] = scene.viewport;

    // One program per name the cuts use, the built-in FIRST so a module of that name overrides it.
    this.transitions = new Map();
    this.warned.clear();
    for (const t of [
      builtinDissolve(),
      builtinOver(),
      ...Object.values(scene.transitions ?? {}),
    ])
      this.transitions.set(t.name, compileTransition(gl, t));
    this.stretches.setScene(scene);
    this.sides.setScene(scene);
    this.luts.setScene(scene);

    // The offscreen targets: rebuilt only when the viewport changed, dropped when nothing needs them — see docs/passes.md.
    this.framePasses = scene.framePasses ?? [];
    // A fade runs its program full-target through the scratch, so a song that dissolves needs one too.
    const wantsScratch =
      scene.layers.some(
        (l) =>
          l.passes?.length ||
          l.clips.some((c) => c.fadeIn || c.fadeOut || c.effect),
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

    this.layers = scene.layers.map((l) => buildLayer(gl, l, vw, vh));
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
    for (const p of [...this.framePasses, ...this.stretches.passes()]) {
      const v = audioByPass[p.id];
      if (v !== undefined) p.audio = v;
    }
  }

  /** One knob of every pass a NODE runs, set in place — a drag's frame, no program rebuilt; false when no pass is that node's. */
  setParam(node: string, name: string, value: number): boolean {
    let found = false;
    const all = [
      ...this.layers.flatMap((l) => l.passes),
      ...this.framePasses,
      ...this.stretches.passes(),
    ];
    for (const p of all)
      if (p.name === node) {
        p.params = { ...p.params, [name]: value };
        found = true;
      }
    return found;
  }

  /** Where a LANE draws, moved in place — a drag's frame, no texture or program rebuilt; false when no layer has that id. */
  setLayerRect(
    id: string,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    const l = this.layers.find((x) => x.id === id);
    if (!l) return false;
    const [vw, vh] = [this.canvas.width, this.canvas.height];
    l.rect = rectToClip(r.x, r.y, r.w, r.h, vw, vh);
    l.px = { x: r.x, y: r.y, w: r.w, h: r.h };
    l.dstAR = r.h > 0 ? r.w / r.h : 0;
    return true;
  }

  /** Run a chain over the ping-pong's front texture, leaving the RESULT there and the framebuffer unbound. */
  private runPasses(
    passes: readonly ScenePass[],
    programs: readonly (PassProgram | null)[],
    presence = 1,
  ): void {
    const pp = this.pingpong;
    if (!pp) return;
    const gl = this.gl;
    const res: [number, number] = [pp.width, pp.height];
    for (let i = 0; i < passes.length; i++) {
      const prog = programs[i];
      if (!prog) continue; // did not compile — this pass is simply not in the chain
      if (isIdentityPass(passes[i])) continue; // at its identity knobs: drawing it would change nothing
      pp.bindBack();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.frontTexture());
      // Blending OFF inside a chain: a pass REPLACES the picture it was handed — see docs/passes.md.
      gl.disable(gl.BLEND);
      drawPass(
        gl,
        prog,
        passes[i],
        res,
        this.timeSec,
        presence,
        this.luts.get(passes[i]?.lut),
      );
      gl.enable(gl.BLEND);
      pp.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Run a transition into the bound target: two pictures in, one out, full-target like any pass. */
  // A side with no picture is the 1×1 transparent texel, which is what makes fade-to-nothing the same path.
  private seedBlend(
    blend: LayerBlend,
    sides: [WebGLTexture, WebGLTexture],
  ): void {
    const gl = this.gl;
    const prog = this.transitionFor(blend.name);
    if (!prog) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sides[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sides[1]);
    gl.activeTexture(gl.TEXTURE0);
    drawTransition(
      gl,
      prog,
      blend.progress,
      [this.canvas.width, this.canvas.height],
      this.timeSec,
    );
  }

  /** How a lane samples its picture: contained when it fills the frame, covering its box otherwise — docs/compositor.md. */
  private uvOf(layer: LayerGL): [number, number, number, number] {
    // The canvas IS the viewport's pixel size, so the lane's px rect compares against it directly.
    const full = isFullFrame(layer.px, this.canvas.width, this.canvas.height);
    return laneUV(layer.srcAR, layer.dstAR, full);
  }

  /** Draw one textured quad of `tex` with the plain program, onto whatever is bound now. */
  private blit(
    tex: WebGLTexture,
    rect: [number, number, number, number],
    /** How to sample the texture — `UV_FILL` for one already shaped like the rect. */
    uv: readonly [number, number, number, number] = UV_FILL,
    look?: QuadLook,
  ): void {
    this.plain.draw(tex, rect, uv, look);
  }

  // Upload a frame from a <video> or a VideoFrame; the realtime loop skips it when the slot already holds that frame (frameGate.ts).
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
  // `motions` says where each slot's shot has MOVED to this frame — absent, or null in a slot, is a shot at rest.
  draw(
    visible: Set<string>,
    blends?: ReadonlyMap<string, LayerBlend>,
    motions?: ReadonlyMap<string, readonly [Motion | null, Motion | null]>,
    // …and which EFFECT each slot's shot runs through — the shot's own look, before its motion (song-video docs/effects.md).
    effects?: ReadonlyMap<string, readonly [string | null, string | null]>,
  ): void {
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
      const motion = motions?.get(layer.id);
      // A cut's only picture is slot 0's, so that is the motion every non-blending path reads.
      const still = motion?.[0] ?? null;
      const effect = effects?.get(layer.id);
      const graded = effect?.[0] ?? null;
      // A blending layer needs no `hasFrame`: the blend says which slots carry a picture THIS frame.
      if (!blend && !layer.hasFrame) continue;

      // Asked per frame: a pass at its identity knobs leaves the layer on the direct path until one moves.
      const shaded = layer.passes.some((p) => !isIdentityPass(p));
      if (pp && (blend || shaded || graded)) {
        // Each side's own runs go FIRST, through the same scratch the blend is about to be seeded into.
        const sides = blend
          ? this.sides.blendSides(layer, blend, motion, effect)
          : null;
        // A cut's only picture through its shot's effect, before the seed takes it.
        const shown = blend
          ? layer.tex
          : this.sides.effected(0, layer.tex, graded);
        // The layer's frame seeds the chain full-viewport, so a pass sampling its neighbourhood has the whole picture.
        pp.bindBack();
        gl.disable(gl.BLEND);
        if (blend && sides) this.seedBlend(blend, sides);
        else {
          // A moved shot leaves the rest of the lane's frame transparent, so the seed starts from nothing.
          if (still) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }
          const frame = { x: 0, y: 0, w: layer.px.w, h: layer.px.h };
          this.blit(
            shown,
            [-1, -1, 1, 1],
            this.uvOf(layer),
            still
              ? {
                  xf: motionAffine(frame, still, frame.w, frame.h),
                  alpha: still.opacity,
                }
              : undefined,
          );
        }
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
      if (!still) {
        this.blit(layer.tex, layer.rect, this.uvOf(layer));
        continue;
      }
      // A moved shot is cropped to its lane's rect, as it is on the two paths that draw through the lane's frame.
      const [vw, vh] = [this.canvas.width, this.canvas.height];
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(...scissorBox(layer.px, vh));
      this.blit(layer.tex, layer.rect, this.uvOf(layer), {
        xf: motionAffine(layer.px, still, vw, vh),
        alpha: still.opacity,
      });
      gl.disable(gl.SCISSOR_TEST);
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

  /** Moves whenever something the next draw reads changed outside an upload — a LUT landing. */
  get revision(): number {
    return this.luts.revision;
  }

  /** Settles once every LUT the scene names is loaded or has failed — what an export awaits before frame 0. */
  ready(): Promise<void> {
    return this.luts.ready();
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
    this.stretches.release();
    gl.deleteTexture(this.empty);
    this.pingpong?.destroy();
    this.pingpong = null;
    this.frameTarget?.destroy();
    this.frameTarget = null;
    this.sides.release();
    this.luts.release();
    gl.deleteProgram(this.plain.prog);
    // Handed back NOW rather than at garbage collection: a browser keeps ~16 live contexts and drops the oldest past that.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}
