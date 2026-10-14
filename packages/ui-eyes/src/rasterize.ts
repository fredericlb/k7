// rasterize.ts — a SHAPE layer drawn once into a 2D canvas at viewport size, which the compositor
// then uploads like any picture: Canvas2D already draws rectangles, arcs and text, and a shape
// is static while its layer is on. See docs/compositor.md.

import type { SceneShape } from "./scene";

// Rasterize a shape layer to a 2D canvas at viewport resolution, once per scene — see docs/compositor.md.
export function rasterizeShapes(
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
