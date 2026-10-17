// geometry.ts — where a picture lands and how it is sampled: the viewport-px rect in clip space,
// and the UV transform that fills a rect without stretching what is in it. Pure arithmetic, no GL
// call, which is why the compositor's tests can pin it without a context. See docs/compositor.md.

/** No transform: sample the texture over its whole face, which is what a rect-shaped one wants. */
export const UV_FILL: readonly [number, number, number, number] = [1, 1, 0, 0];

/** The UV transform that COVERS a `dstAR` rect with a `srcAR` picture, cropping evenly; identity when either is unknown — docs/compositor.md. */
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

/** The UV transform that CONTAINS a `srcAR` picture in a `dstAR` rect, bars either side; identity when either is unknown — docs/compositor.md. */
export function containUV(
  srcAR: number,
  dstAR: number,
): [number, number, number, number] {
  if (!(srcAR > 0) || !(dstAR > 0) || srcAR === dstAR) return [1, 1, 0, 0];
  const wide = srcAR > dstAR;
  const sx = wide ? 1 : dstAR / srcAR;
  const sy = wide ? srcAR / dstAR : 1;
  return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
}

/** Whether a lane's px rect is the whole frame — the case whose bars are the FRAME's, so it contains rather than covers. */
export const isFullFrame = (
  px: { x: number; y: number; w: number; h: number },
  vw: number,
  vh: number,
): boolean =>
  Math.abs(px.x) < 1 &&
  Math.abs(px.y) < 1 &&
  Math.abs(px.w - vw) < 1 &&
  Math.abs(px.h - vh) < 1;

/** How a lane samples its picture: a full-frame lane is CONTAINED (a phone clip keeps its whole picture), a boxed one COVERS its box. */
export const laneUV = (
  srcAR: number,
  dstAR: number,
  fullFrame: boolean,
): [number, number, number, number] =>
  fullFrame ? containUV(srcAR, dstAR) : coverUV(srcAR, dstAR);

/** What a frame source is shaped like, or 0 when it will not say — see `upload`. */
export function sourceAR(src: TexImageSource): number {
  const v = src as Partial<HTMLVideoElement> &
    Partial<VideoFrame> & { width?: number; height?: number };
  const w = v.videoWidth || v.displayWidth || v.width || 0;
  const h = v.videoHeight || v.displayHeight || v.height || 0;
  return w > 0 && h > 0 ? w / h : 0;
}

// The viewport has a top-left origin, clip space is bottom-left: map a viewport-px rect to clip space, flipping y.
export function rectToClip(
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
