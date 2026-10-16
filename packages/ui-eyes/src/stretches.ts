// stretches.ts — the runs a fade puts a SHOT through before the blend: one compiled chain per
// stretch the scene names, and one target per picture slot. Two targets and not the ping-pong,
// because the blend reads BOTH stretched pictures at once and the ping-pong is the scratch each
// run passes through on its way there. See song-video/docs/transitions.md and docs/passes.md.

import { compilePass, type PassProgram, RenderTarget } from "./passes";
import type { ScenePass, VideoScene } from "./scene";

/** One stretch, its passes and their programs index for index; a null program did not build and is stepped over. */
export interface StretchRun {
  passes: ScenePass[];
  programs: (PassProgram | null)[];
}

/** Does any fade in the scene name a stretch? Nothing is allocated for a scene where none does. */
const wanted = (scene: VideoScene): boolean =>
  scene.layers.some((l) =>
    l.clips.some((c) => c.fadeIn?.chain || c.fadeOut?.chain),
  );

export class Stretches {
  private gl: WebGL2RenderingContext;
  private runs = new Map<string, StretchRun>();
  private slots: [RenderTarget, RenderTarget] | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** Compile every stretch the scene carries, and size the two slot targets to its viewport. */
  setScene(scene: VideoScene): void {
    this.release();
    for (const [name, passes] of Object.entries(scene.stretches ?? {}))
      this.runs.set(name, {
        passes,
        programs: passes.map((p) => compilePass(this.gl, p)),
      });
    const [vw, vh] = scene.viewport;
    if (wanted(scene))
      this.slots = [
        new RenderTarget(this.gl, vw, vh),
        new RenderTarget(this.gl, vw, vh),
      ];
  }

  /** The run a fade names, or undefined — the shot is then drawn as it is, which is what the compile already said. */
  run(name: string): StretchRun | undefined {
    return this.runs.get(name);
  }

  /** Where slot `s`'s stretched picture is left for the blend to read. */
  target(s: 0 | 1): RenderTarget | null {
    return this.slots?.[s] ?? null;
  }

  /** Every pass of every run, for the live values the host refreshes — a stretch's shader may read `uAudio` too. */
  passes(): ScenePass[] {
    return [...this.runs.values()].flatMap((r) => r.passes);
  }

  release(): void {
    for (const r of this.runs.values())
      for (const p of r.programs) if (p) this.gl.deleteProgram(p.prog);
    this.runs.clear();
    for (const t of this.slots ?? []) t.destroy();
    this.slots = null;
  }
}
