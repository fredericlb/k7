// motion.ts — a shot's animation as the renderer needs it: the value of each property at t, and
// the clip-space affine that moves a drawn quad by it. A shot moves inside its LANE's frame and
// the lane's rect crops it, on every path — plain, through passes, through a blend — so a shot
// looks the same mid-dissolve as on either side of it. Pure: no GL call. See docs/motion.md.

import { type Key, valueAt } from "@studio/song-schema/keyframes";
import type { SceneAnimate, SceneClip } from "./scene";
import type { LayerFrame } from "./timeline";

/** Where a shot is at an instant, relative to its lane's rect: px offsets, a scale about the centre, an opacity, degrees clockwise. */
export interface Motion {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotate: number;
}

/** A 3×3 affine in column-major order, as `uniformMatrix3fv` takes it. */
export type Affine = Float32Array;

export const IDENTITY: Affine = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

const at = (
  keys: SceneAnimate[keyof SceneAnimate],
  t: number,
  rest: number,
): number => (keys?.length ? valueAt(keys as readonly Key[], t) : rest);

/** The shot's motion `t` seconds into the timeline, or null when it is at rest — which is what costs nothing. */
export function motionAt(clip: SceneClip, t: number): Motion | null {
  const a = clip.animate;
  if (!a) return null;
  const local = t - clip.start;
  const m: Motion = {
    x: at(a.x, local, 0),
    y: at(a.y, local, 0),
    scale: at(a.scale, local, 1),
    opacity: at(a.opacity, local, 1),
    rotate: at(a.rotate, local, 0),
  };
  const still =
    m.x === 0 &&
    m.y === 0 &&
    m.scale === 1 &&
    m.opacity === 1 &&
    m.rotate === 0;
  return still ? null : m;
}

/** Each picture slot's motion this frame — slot 0 the outgoing side of a blend or the only picture of a cut, slot 1 the incoming. */
// `out` lets the realtime loop refill one tuple per lane instead of allocating one per frame.
export function slotMotions(
  frame: LayerFrame,
  t: number,
  out: [Motion | null, Motion | null] = [null, null],
): [Motion | null, Motion | null] {
  const a = frame.blend ? frame.from : frame.to;
  out[0] = a ? motionAt(a.clip, t) : null;
  out[1] = frame.blend && frame.to ? motionAt(frame.to.clip, t) : null;
  return out;
}

/** The clip-space affine moving a quad drawn at `rect` (px, top-left origin) by `m`, in a target `fw`×`fh` px. */
// Built in PIXELS and only then mapped to clip space, so a turn keeps its angles on a target that is not square.
export function motionAffine(
  rect: { x: number; y: number; w: number; h: number },
  m: Motion,
  fw: number,
  fh: number,
): Affine {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = (m.rotate * Math.PI) / 180;
  const cos = Math.cos(r) * m.scale;
  const sin = Math.sin(r) * m.scale;
  // clip → px is P = ((cx+1)·fw/2, (1−cy)·fh/2); the move is P' = c + (x,y) + R·s·(P − c); then back.
  const sx = fw / 2;
  const sy = fh / 2;
  // The linear part in clip space, conjugated by the px scaling — y flips both ways, so the sign of sin swaps.
  const a00 = cos;
  const a01 = (sin * sy) / sx;
  const a10 = (-sin * sx) / sy;
  const a11 = cos;
  // Where the rect's centre goes, in clip space, and the translation that puts it there.
  const ccx = cx / sx - 1;
  const ccy = 1 - cy / sy;
  const tx = ccx + m.x / sx - (a00 * ccx + a01 * ccy);
  const ty = ccy - m.y / sy - (a10 * ccx + a11 * ccy);
  return new Float32Array([a00, a10, 0, a01, a11, 0, tx, ty, 1]);
}

/** The lane's rect as a scissor box in GL's bottom-left pixel space, for a target `fh` px high. */
export function scissorBox(
  rect: { x: number; y: number; w: number; h: number },
  fh: number,
): [number, number, number, number] {
  return [
    Math.round(rect.x),
    Math.round(fh - rect.y - rect.h),
    Math.round(rect.w),
    Math.round(rect.h),
  ];
}

/** Does any shot in these layers animate? Nothing is allocated for a scene where none does. */
export const animates = (
  layers: readonly { clips: readonly SceneClip[] }[],
): boolean =>
  layers.some((l) =>
    l.clips.some((c) => c.animate && Object.keys(c.animate).length),
  );
