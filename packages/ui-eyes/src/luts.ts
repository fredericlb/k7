// luts.ts — every LUT a scene's passes name, fetched and uploaded as a 3D texture ONCE per URL
// however many passes read it. Loading is asynchronous and drawing is not: a pass whose LUT has
// not arrived reads a size of 0 and lets its picture through, and an export waits for `ready`.
// See docs/luts.md.

import { parseCube } from "./cube";
import type { VideoScene } from "./scene";

/** One LUT on the GPU: its texture and its edge size. */
export interface LutTexture {
  tex: WebGLTexture;
  size: number;
}

export class Luts {
  private gl: WebGL2RenderingContext;
  private loaded = new Map<string, LutTexture>();
  private pending: Promise<void> = Promise.resolve();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** Start loading every LUT `scene` names; a URL already on the GPU is kept, the others dropped. */
  setScene(scene: VideoScene): void {
    const passes = [
      ...scene.layers.flatMap((l) => l.passes ?? []),
      ...(scene.framePasses ?? []),
      ...Object.values(scene.stretches ?? {}).flat(),
    ];
    const urls = new Set(
      passes.map((p) => p.lut).filter((u): u is string => !!u),
    );
    for (const [url, l] of this.loaded)
      if (!urls.has(url)) {
        this.gl.deleteTexture(l.tex);
        this.loaded.delete(url);
      }
    this.pending = Promise.all(
      [...urls].filter((u) => !this.loaded.has(u)).map((u) => this.load(u)),
    ).then(() => {});
  }

  /** Settles once every LUT of the scene is uploaded or has failed — what an export awaits before frame 0. */
  ready(): Promise<void> {
    return this.pending;
  }

  /** The LUT for `url`, or null while it loads or after it failed. */
  get(url: string | undefined): LutTexture | null {
    return url ? (this.loaded.get(url) ?? null) : null;
  }

  // Fetch, parse, upload; a failure is said once and the pass draws its picture through.
  private async load(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const lut = parseCube(await res.text());
      const gl = this.gl;
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_3D, tex);
      // RGBA16F: filterable in WebGL2 without an extension, which a 32-bit float texture is not.
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGBA16F,
        lut.size,
        lut.size,
        lut.size,
        0,
        gl.RGBA,
        gl.FLOAT,
        lut.data,
      );
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
        gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_3D, null);
      this.loaded.set(url, { tex, size: lut.size });
    } catch (e) {
      console.warn(
        `eyes: LUT ${url} could not be read — ${(e as Error).message}; the picture goes through ungraded`,
      );
    }
  }

  release(): void {
    for (const l of this.loaded.values()) this.gl.deleteTexture(l.tex);
    this.loaded.clear();
  }
}
