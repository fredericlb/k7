// nodeMotion.ts — what moved between two layouts, and how far each node still has to go.
// FLIP: React draws every node at its FINAL place and this carries the offset it is drawn WITH
// back to zero, so a re-layout reads as the cards sliding. Also what enters and what leaves, as
// one presence number each. Pure arithmetic — no DOM, no React. See docs/nodeMotion.md.

import { approach } from "./camera";

/** Where a node sits. The slice of a laid-out node this file needs, so a test needs no dagre. */
export interface MotionNode {
  id: string;
  x: number;
  y: number;
}

/**
 * One node's remaining distance and its presence.
 *
 * `dx`/`dy` are an OFFSET from where the node is drawn, not a position: React owns the position
 * and this owns the difference, which is what lets a re-layout land mid-flight without the two
 * disagreeing about where anything is.
 */
export interface Motion {
  dx: number;
  dy: number;
  /** 0 = not there (transparent, small), 1 = settled. */
  a: number;
  /** What `a` is heading for: 1 for a node in the layout, 0 for one on its way out. */
  at: number;
}

/** A node the layout no longer has, kept on screen until its presence reaches 0. */
export interface Ghost<N extends MotionNode> {
  node: N;
  /** Where it was last drawn — a ghost is not in the new layout, so nothing else says. */
  x: number;
  y: number;
}

export interface Plan<N extends MotionNode> {
  motions: Map<string, Motion>;
  ghosts: Ghost<N>[];
  /** Whether anything actually has to move. Nothing did ⇒ no loop, no inline styles, no cost. */
  moving: boolean;
}

/** How fast a card covers the ground it has left. 70 ms ⇒ ~90 % of the way in 230 ms. */
export const MOVE_HALF_LIFE = 70;
/** Fading in and out is quicker than travelling: a card half there is a card you read as broken. */
export const FADE_HALF_LIFE = 45;
/** Under this many world px a "move" is a layout rounding, not a movement worth drawing. */
export const MOVE_EPSILON = 0.5;
/** How small a node is when it is not there yet. Not 0: a card scaling from nothing reads as a zoom. */
export const ENTER_SCALE = 0.84;

/**
 * The motion a new layout implies, given where the old one had got to.
 *
 * `before` is the previous layout's positions and `flying` what was still in flight, because the
 * two together are where a node actually IS: a re-layout arriving mid-slide has to continue from
 * the screen rather than from the position the last layout never reached.
 *
 * Identity is the node id, which `buildGraph` mints from names — so a renamed module reads as one
 * leaving and one arriving, which is what it is, and a re-ordered chain keeps its ids and only
 * moves. That is the whole discriminator; nothing here compares labels.
 */
export function planMotion<N extends MotionNode>(
  before: Map<string, Ghost<N>>,
  flying: Map<string, Motion>,
  next: readonly N[],
  /**
   * How far a card may travel, in world px, before it stops being worth drawing as a move.
   *
   * Past a screen or so, a slide is not read as one thing going somewhere — it is read as
   * something shooting across the view, and half a dozen of them at once is flicker rather than
   * motion. The mixer view is where this bites: turning it on re-frames the camera AND pulls
   * every strip onto one rank, so cards that were off screen would come flying in from outside
   * it. Those fade up where they belong instead, which is what "it was not on screen a moment
   * ago" honestly looks like. The caller sets it from the camera; omitted, nothing is capped.
   */
  maxTravel = Number.POSITIVE_INFINITY,
): Plan<N> {
  const motions = new Map<string, Motion>();
  const ghosts: Ghost<N>[] = [];
  let moving = false;

  for (const n of next) {
    const was = before.get(n.id);
    if (!was) {
      // New: it is drawn where it belongs and fades up into it. No slide — there is no
      // "from" that means anything, and inventing one would claim it came from somewhere.
      motions.set(n.id, { dx: 0, dy: 0, a: 0, at: 1 });
      moving = true;
      continue;
    }
    const f = flying.get(n.id);
    let dx = was.x + (f?.dx ?? 0) - n.x;
    let dy = was.y + (f?.dy ?? 0) - n.y;
    let a = f?.a ?? 1;
    // Too far to read as a movement: ARRIVE instead, at the place it is going. There is no
    // deception in that — a card that has to cross more than a screenful was not where the eye
    // could follow it from, so fading up where it belongs is the honest picture.
    if (Math.hypot(dx, dy) > maxTravel) {
      dx = 0;
      dy = 0;
      a = 0;
    }
    // A node that was on its way OUT and is back in the layout turns around rather than
    // finishing its exit — a replace that lands on the same id is one card, not two.
    if (Math.abs(dx) < MOVE_EPSILON && Math.abs(dy) < MOVE_EPSILON && a === 1)
      continue;
    motions.set(n.id, { dx, dy, a, at: 1 });
    moving = true;
  }

  const kept = new Set(next.map((n) => n.id));
  for (const [id, was] of before) {
    if (kept.has(id)) continue;
    const f = flying.get(id);
    // Its exit starts from where it had got to, so a card removed mid-slide does not jump back.
    ghosts.push({
      node: was.node,
      x: was.x + (f?.dx ?? 0),
      y: was.y + (f?.dy ?? 0),
    });
    motions.set(id, { dx: 0, dy: 0, a: f?.a ?? 1, at: 0 });
    moving = true;
  }

  return { motions, ghosts, moving };
}

/**
 * Advance every motion by `dt` ms. Answers whether anything is still moving.
 *
 * Exponential, like the camera's zoom glide and for the same reason: two 8 ms frames on a 120 Hz
 * screen must leave what one 16 ms frame leaves at 60, or the same movement arrives sooner on the
 * better screen. Settled entries are DELETED, so the caller can clear that node's inline style
 * once and then leave it alone.
 */
export function advanceMotion(
  motions: Map<string, Motion>,
  dt: number,
): boolean {
  const move = approach(dt, MOVE_HALF_LIFE);
  const fade = approach(dt, FADE_HALF_LIFE);
  let moving = false;
  for (const [id, m] of motions) {
    m.dx += (0 - m.dx) * move;
    m.dy += (0 - m.dy) * move;
    m.a += (m.at - m.a) * fade;
    const still =
      Math.abs(m.dx) >= MOVE_EPSILON ||
      Math.abs(m.dy) >= MOVE_EPSILON ||
      Math.abs(m.at - m.a) >= 0.01;
    if (still) {
      moving = true;
      continue;
    }
    // An exponential never quite arrives: land it, and drop it so nothing writes to it again.
    m.dx = 0;
    m.dy = 0;
    m.a = m.at;
    if (m.at === 1) motions.delete(id);
  }
  return moving;
}

/** The `transform` one motion draws with — the offset it still carries, and how present it is. */
export function motionTransform(m: Motion): string {
  const s = ENTER_SCALE + (1 - ENTER_SCALE) * m.a;
  return `translate(${m.dx}px, ${m.dy}px) scale(${s})`;
}

/** Where a node IS this frame, for anything drawn between nodes — the cables. */
export function motionPos<N extends MotionNode>(
  n: N,
  motions: Map<string, Motion>,
): { x: number; y: number } {
  const m = motions.get(n.id);
  return m ? { x: n.x + m.dx, y: n.y + m.dy } : { x: n.x, y: n.y };
}
