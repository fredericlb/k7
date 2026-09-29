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

/** One node's remaining distance and its presence — `dx`/`dy` are an OFFSET, not a position. */
export interface Motion {
  dx: number;
  dy: number;
  /** 0 = not there (transparent, small), 1 = settled. */
  a: number;
  /** What `a` is heading for: 1 for a node in the layout, 0 for one on its way out. */
  at: number;
  /** How fast this one travels, when not `MOVE_HALF_LIFE` — an organize is slower, docs/nodeMotion.md. */
  half?: number;
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
/** An organize moves every card at once, far: slower, so the eye can follow where each one went. 130 ms ⇒ ~90 % in 430 ms. */
export const ORGANIZE_HALF_LIFE = 130;
/** Fading in and out is quicker than travelling: a card half there is a card you read as broken. */
export const FADE_HALF_LIFE = 45;
/** Under this many world px a "move" is a layout rounding, not a movement worth drawing. */
export const MOVE_EPSILON = 0.5;
/** How small a node is when it is not there yet. Not 0: a card scaling from nothing reads as a zoom. */
export const ENTER_SCALE = 0.84;

/** The motion a new layout implies, given where the old one had got to — docs/nodeMotion.md. */
export function planMotion<N extends MotionNode>(
  before: Map<string, Ghost<N>>,
  flying: Map<string, Motion>,
  next: readonly N[],
  /** How far a card may travel in world px before it fades up in place instead — docs/nodeMotion.md. */
  maxTravel = Number.POSITIVE_INFINITY,
  /** A travelling half-life other than `MOVE_HALF_LIFE`, for every card that moves. */
  half?: number,
): Plan<N> {
  const motions = new Map<string, Motion>();
  const ghosts: Ghost<N>[] = [];
  let moving = false;

  for (const n of next) {
    const was = before.get(n.id);
    if (!was) {
      // New: drawn where it belongs and fading up into it, since no "from" would mean anything.
      motions.set(n.id, { dx: 0, dy: 0, a: 0, at: 1 });
      moving = true;
      continue;
    }
    const f = flying.get(n.id);
    let dx = was.x + (f?.dx ?? 0) - n.x;
    let dy = was.y + (f?.dy ?? 0) - n.y;
    let a = f?.a ?? 1;
    // Too far to read as a movement: ARRIVE instead, at the place it is going — docs/nodeMotion.md.
    if (Math.hypot(dx, dy) > maxTravel) {
      dx = 0;
      dy = 0;
      a = 0;
    }
    // A node on its way OUT and back in the layout turns around rather than finishing its exit.
    if (Math.abs(dx) < MOVE_EPSILON && Math.abs(dy) < MOVE_EPSILON && a === 1)
      continue;
    // A card still flying keeps its pace: an organize's reload landing mid-slide must not speed it up.
    const pace = half ?? f?.half;
    motions.set(
      n.id,
      pace ? { dx, dy, a, at: 1, half: pace } : { dx, dy, a, at: 1 },
    );
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

/** Advance every motion by `dt` ms, exponentially; settled entries are DELETED — docs/nodeMotion.md. */
export function advanceMotion(
  motions: Map<string, Motion>,
  dt: number,
): boolean {
  const move = approach(dt, MOVE_HALF_LIFE);
  const fade = approach(dt, FADE_HALF_LIFE);
  let moving = false;
  for (const [id, m] of motions) {
    const f = m.half ? approach(dt, m.half) : move;
    m.dx += (0 - m.dx) * f;
    m.dy += (0 - m.dy) * f;
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
