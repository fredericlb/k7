// rasterize.ts — a SHAPE layer drawn once into a 2D canvas at viewport size, which the compositor
// then uploads like any picture: Canvas2D already draws rectangles, arcs and text, and a shape
// is static while its layer is on. See docs/compositor.md.

import type { SceneShape } from "./scene";
import { drawText } from "./text";

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
      // Set as a BLOCK: written breaks kept, wrapped in `w`, aligned, boxed and shadowed when asked (text.ts).
      drawText(ctx, s);
    }
  }
  return canvas;
}
