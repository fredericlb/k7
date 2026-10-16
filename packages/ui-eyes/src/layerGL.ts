// layerGL.ts — one lane's GL state, built from the scene: its texture slots, its rect in clip
// space and in px, the aspects that keep a picture from stretching, and its pass programs. A
// shape lane is rasterised and uploaded here, once per scene; a video lane's slots stay empty
// until its first frame. See docs/compositor.md.

import { rectToClip } from "./geometry";
import { compilePass, type PassProgram } from "./passes";
import { rasterizeShapes } from "./rasterize";
import type { ScenePass, VideoLayer } from "./scene";

export interface LayerGL {
  id: string;
  tex: WebGLTexture;
  // The SECOND picture, only on a lane that dissolves: a lane that never does allocates nothing.
  tex2: WebGLTexture | null;
  rect: [number, number, number, number]; // clip space, precomputed from the viewport
  px: { x: number; y: number; w: number; h: number }; // …and the same rect in viewport px, which a shot moves inside
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

/** A 1×1 transparent texel: what a fade goes TO when nothing follows, so GLSL needs no branch. */
export function emptyTexel(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = makeSlot(gl);
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
  return tex;
}

/** The GL state of one lane of `scene`, in a viewport `vw`×`vh` px. */
export function buildLayer(
  gl: WebGL2RenderingContext,
  l: VideoLayer,
  vw: number,
  vh: number,
): LayerGL {
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
      px: { x: 0, y: 0, w: vw, h: vh },
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
    px: { x: l.x, y: l.y, w: l.w, h: l.h },
    dstAR: l.h > 0 ? l.w / l.h : 0,
    srcAR: 0, // said by the first upload, not by the document
    hasFrame: false,
    passes: l.passes ?? [],
    programs: (l.passes ?? []).map((p) => compilePass(gl, p)),
  };
}
