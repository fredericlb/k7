// rollMode.ts — what a press on the piano roll's lanes MEANS. The roll's modes are its own rather
// than the timeline's tools: what a lane holds is notes, so `create` and `remove` are the two acts,
// and neither means anything on a track. The one thing a reader would get wrong: `select` is the
// default HERE, where drawing used to be — a bare drag now frames notes rather than laying one down.
// See apps/k7/frontend/docs/clipEditors.md.

import { m } from "./paraglide/messages.js";

/** Where a press goes. Each stands on one verb, so a gesture stays one command and one Ctrl+Z. */
export const ROLL_MODES = ["select", "create", "remove", "takes"] as const;
export type RollMode = (typeof ROLL_MODES)[number];

/** …all but `takes`, for a roll with no event to record takes into (a bare sequence file). */
export const ROLL_SOLO_MODES = ROLL_MODES.filter((m) => m !== "takes");

export const isRollMode = (s: string): s is RollMode =>
  (ROLL_MODES as readonly string[]).includes(s);

/** The condition name a binding reads — `{ if: "roll_create", … }`, the truthiness test keys.ts does. */
export const rollCondition = (m: RollMode): string => `roll_${m}`;

/** What each mode does, for the strip's tooltip and the status line — a mode you cannot see is one you edit in by accident. */
export const ROLL_PRESS: Record<RollMode, () => string> = {
  select: () => m["roll.select"](),
  create: () => m["roll.create"](),
  remove: () => m["roll.remove"](),
  takes: () => m["roll.takes"](),
};

/**
 * Does a press on a NOTE edit it, rather than removing it? Only `remove` takes a note away, and
 * `select` is the one that moves it — `create` leaves a note alone, its business being the lane.
 */
export const noteIsEditable = (m: RollMode): boolean => m === "select";

/** …and does a press on a bare LANE draw one? `create` alone; the others have their own use for it. */
export const laneDraws = (m: RollMode): boolean => m === "create";
