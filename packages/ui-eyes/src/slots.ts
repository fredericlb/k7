// slots.ts — what happens to ONE picture slot before the lane composites it: the shot's own
// effect, then its motion, then the fade's stretch, each into a target of that slot's own. A
// blend reads both slots at once, so neither may still sit in the scratch the other is about to
// use. Every step is skipped, and allocates nothing, for a shot that does not need it.
// See docs/compositor.md and song-video/docs/effects.md.

import type { LayerBlend } from "./compositor";
import { UV_FILL } from "./geometry";
import type { LayerGL } from "./layerGL";
import { animates, type Motion, motionAffine } from "./motion";
import type { PassProgram, PingPong } from "./passes";
import { RenderTarget } from "./passes";
import type { QuadLook } from "./plain";
import type { ScenePass, VideoScene } from "./scene";
import type { Stretches } from "./stretches";
import type { SlotStretch } from "./timeline";

/** What the compositor lends the slots: its one quad, its chain runner, its scratch. */
export interface SlotHost {
  gl: WebGL2RenderingContext;
  blit: (
    tex: WebGLTexture,
    rect: [number, number, number, number],
    uv?: readonly [number, number, number, number],
    look?: QuadLook,
  ) => void;
  runPasses: (
    passes: readonly ScenePass[],
    programs: readonly (PassProgram | null)[],
    presence?: number,
  ) => void;
  scratch: () => PingPong | null;
  stretches: Stretches;
  empty: WebGLTexture;
}

type Pair = [RenderTarget, RenderTarget];
const FULL: [number, number, number, number] = [-1, -1, 1, 1];

/** Does any shot in the scene name an effect? Its targets exist only then. */
export const grades = (scene: VideoScene): boolean =>
  scene.layers.some((l) => l.clips.some((c) => c.effect));

export class Sides {
  private h: SlotHost;
  private moved: Pair | null = null;
  private graded: Pair | null = null;

  constructor(host: SlotHost) {
    this.h = host;
  }

  /** Size the targets to the scene's viewport, allocating only those some shot needs. */
  setScene(scene: VideoScene): void {
    this.release();
    const [vw, vh] = scene.viewport;
    const pair = (): Pair => [
      new RenderTarget(this.h.gl, vw, vh),
      new RenderTarget(this.h.gl, vw, vh),
    ];
    if (animates(scene.layers)) this.moved = pair();
    if (grades(scene)) this.graded = pair();
  }

  /** Run `tex` through `run` in the scratch and copy the result into `target`: the shape every step shares. */
  private through(
    tex: WebGLTexture,
    passes: readonly ScenePass[],
    programs: readonly (PassProgram | null)[],
    presence: number,
    target: RenderTarget,
  ): WebGLTexture | null {
    const pp = this.h.scratch();
    if (!pp) return null;
    const gl = this.h.gl;
    // Seeded full-target with UV_FILL, as the blend samples a slot — the two must agree on where the picture is.
    pp.bindBack();
    gl.disable(gl.BLEND);
    this.h.blit(tex, FULL);
    gl.enable(gl.BLEND);
    pp.swap();
    this.h.runPasses(passes, programs, presence);
    // Copied OUT of the scratch, since the other slot's run and the blend itself both need it next.
    target.bind(true);
    gl.disable(gl.BLEND);
    this.h.blit(pp.frontTexture(), FULL);
    gl.enable(gl.BLEND);
    return target.texture;
  }

  /** The shot's own EFFECT run over its picture, for as long as it is on; the picture as it came when it names none. */
  effected(slot: 0 | 1, tex: WebGLTexture, name: string | null): WebGLTexture {
    const run = name ? this.h.stretches.run(name) : undefined;
    const target = this.graded?.[slot];
    if (!run || !target) return tex;
    return this.through(tex, run.passes, run.programs, 1, target) ?? tex;
  }

  /** The picture MOVED inside the lane's frame, premultiplied for the blend that reads it. */
  movedSide(
    slot: 0 | 1,
    tex: WebGLTexture,
    layer: LayerGL,
    m: Motion | null,
  ): WebGLTexture {
    const target = this.moved?.[slot];
    if (!m || !target) return tex;
    const gl = this.h.gl;
    // The target IS the lane's frame, so the move is measured in the lane's own px: the final blit puts it on the rect.
    const frame = { x: 0, y: 0, w: layer.px.w, h: layer.px.h };
    target.bind(true);
    gl.disable(gl.BLEND);
    this.h.blit(tex, FULL, UV_FILL, {
      xf: motionAffine(frame, m, frame.w, frame.h),
      alpha: m.opacity,
      premultiplied: true,
    });
    gl.enable(gl.BLEND);
    return target.texture;
  }

  /** The fade's STRETCH over the picture, into the stretch's own slot target. */
  stretched(
    slot: 0 | 1,
    tex: WebGLTexture,
    s: SlotStretch | undefined,
  ): WebGLTexture {
    const run = s ? this.h.stretches.run(s.chain) : undefined;
    const target = this.h.stretches.target(slot);
    if (!s || !run || !target) return tex;
    return (
      this.through(tex, run.passes, run.programs, s.presence, target) ?? tex
    );
  }

  /** The two pictures a blend reads: each slot effected, moved and stretched, in that order, else the transparent texel. */
  blendSides(
    layer: LayerGL,
    blend: LayerBlend,
    motion: readonly [Motion | null, Motion | null] | undefined,
    effect: readonly [string | null, string | null] | undefined,
  ): [WebGLTexture, WebGLTexture] {
    const side = (slot: 0 | 1, tex: WebGLTexture, s: SlotStretch | undefined) =>
      this.stretched(
        slot,
        this.movedSide(
          slot,
          this.effected(slot, tex, effect?.[slot] ?? null),
          layer,
          motion?.[slot] ?? null,
        ),
        s,
      );
    return [
      blend.from ? side(0, layer.tex, blend.stretch?.from) : this.h.empty,
      blend.to && layer.tex2
        ? side(1, layer.tex2, blend.stretch?.to)
        : this.h.empty,
    ];
  }

  release(): void {
    for (const t of [...(this.moved ?? []), ...(this.graded ?? [])])
      t.destroy();
    this.moved = null;
    this.graded = null;
  }
}
