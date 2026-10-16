// compositor.ts — the viewport in WebGL2: one texture per layer, one textured quad each,
// composited bottom-first. The ONE renderer both drivers share, because texImage2D takes an
// HTMLVideoElement and a VideoFrame identically — so it never learns which driver owns it.
// It OWNS its canvas (a React-owned one races two GL contexts). A layer may carry GLSL passes
// and so may the finished frame: passes.ts runs those, docs/passes.md is the page.

import { coverUV, sourceAR, UV_FILL } from "./geometry";
import { buildLayer, emptyTexel, type LayerGL } from "./layerGL";
import { animates, type Motion, motionAffine, scissorBox } from "./motion";
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
import type { ScenePass, VideoScene } from "./scene";
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
  // Where a MOVED shot is drawn before a blend reads it, one per slot; allocated only when a shot animates — docs/motion.md.
  private moved: [RenderTarget, RenderTarget] | null = null;
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
      builtinOver(),
      ...Object.values(scene.transitions ?? {}),
    ])
      this.transitions.set(t.name, compileTransition(gl, t));
    this.stretches.setScene(scene);
    for (const t of this.moved ?? []) t.destroy();
    this.moved = animates(scene.layers)
      ? [new RenderTarget(gl, vw, vh), new RenderTarget(gl, vw, vh)]
      : null;

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
      pp.bindBack();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.frontTexture());
      // Blending OFF inside a chain: a pass REPLACES the picture it was handed — see docs/passes.md.
      gl.disable(gl.BLEND);
      drawPass(gl, prog, passes[i], res, this.timeSec, presence);
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

  /** The two pictures a blend reads: each slot's texture, through its stretch when it runs one, else the transparent texel. */
  private blendSides(
    layer: LayerGL,
    blend: LayerBlend,
    motion: readonly [Motion | null, Motion | null] | undefined,
  ): [WebGLTexture, WebGLTexture] {
    // Moved FIRST, then stretched: the motion is the shot's own, the stretch what the fade does to it.
    return [
      blend.from
        ? this.stretched(
            0,
            this.movedSide(0, layer.tex, layer, motion?.[0] ?? null),
            blend.stretch?.from,
          )
        : this.empty,
      blend.to && layer.tex2
        ? this.stretched(
            1,
            this.movedSide(1, layer.tex2, layer, motion?.[1] ?? null),
            blend.stretch?.to,
          )
        : this.empty,
    ];
  }

  /** Run one slot's picture through its stretch into that slot's target, or hand it back untouched. */
  private stretched(
    slot: 0 | 1,
    tex: WebGLTexture,
    s: SlotStretch | undefined,
  ): WebGLTexture {
    const run = s ? this.stretches.run(s.chain) : undefined;
    const target = this.stretches.target(slot);
    const pp = this.pingpong;
    if (!s || !run || !target || !pp) return tex;
    const gl = this.gl;
    // Seeded full-target with UV_FILL, as the blend samples a slot — the two must agree on where the picture is.
    pp.bindBack();
    gl.disable(gl.BLEND);
    this.blit(tex, [-1, -1, 1, 1]);
    gl.enable(gl.BLEND);
    pp.swap();
    this.runPasses(run.passes, run.programs, s.presence);
    // Copied OUT of the scratch, since the other slot's run and the blend itself both need it next.
    target.bind(true);
    gl.disable(gl.BLEND);
    this.blit(pp.frontTexture(), [-1, -1, 1, 1]);
    gl.enable(gl.BLEND);
    return target.texture;
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

  /** A slot's picture MOVED inside the lane's frame, into that slot's own target, premultiplied for the blend that reads it. */
  private movedSide(
    slot: 0 | 1,
    tex: WebGLTexture,
    layer: LayerGL,
    m: Motion | null,
  ): WebGLTexture {
    const target = this.moved?.[slot];
    if (!m || !target) return tex;
    const gl = this.gl;
    // The target IS the lane's frame, so the move is measured in the lane's own px: the final blit puts it on the rect.
    const frame = { x: 0, y: 0, w: layer.px.w, h: layer.px.h };
    target.bind(true);
    gl.disable(gl.BLEND);
    this.blit(tex, [-1, -1, 1, 1], UV_FILL, {
      xf: motionAffine(frame, m, frame.w, frame.h),
      alpha: m.opacity,
      premultiplied: true,
    });
    gl.enable(gl.BLEND);
    return target.texture;
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
  // `motions` says where each slot's shot has MOVED to this frame — absent, or null in a slot, is a shot at rest.
  draw(
    visible: Set<string>,
    blends?: ReadonlyMap<string, LayerBlend>,
    motions?: ReadonlyMap<string, readonly [Motion | null, Motion | null]>,
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
      // A blending layer needs no `hasFrame`: the blend says which slots carry a picture THIS frame.
      if (!blend && !layer.hasFrame) continue;

      if (pp && (blend || layer.passes.length)) {
        // Each side's stretch runs FIRST, through the same scratch the blend is about to be seeded into.
        const sides = blend ? this.blendSides(layer, blend, motion) : null;
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
            layer.tex,
            [-1, -1, 1, 1],
            coverUV(layer.srcAR, layer.dstAR),
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
        this.blit(layer.tex, layer.rect, coverUV(layer.srcAR, layer.dstAR));
        continue;
      }
      // A moved shot is cropped to its lane's rect, as it is on the two paths that draw through the lane's frame.
      const [vw, vh] = [this.canvas.width, this.canvas.height];
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(...scissorBox(layer.px, vh));
      this.blit(layer.tex, layer.rect, coverUV(layer.srcAR, layer.dstAR), {
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
    for (const t of this.moved ?? []) t.destroy();
    this.moved = null;
    gl.deleteProgram(this.plain.prog);
    // Handed back NOW rather than at garbage collection: a browser keeps ~16 live contexts and drops the oldest past that.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}
