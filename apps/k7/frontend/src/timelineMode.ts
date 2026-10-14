// timelineMode.ts — which MODE the timeline's keyboard is in, and it is DERIVED rather than
// stored. The three states already exist and already exclude one another (`move`, `sel`, neither);
// naming them must not add a fourth source of truth that can disagree with them — the rule
// `packages/song/docs/surfaces.md` states for `surfaces/` against a `project_type`.
// See apps/k7/frontend/docs/timeline.md.

/** Where the keyboard is. A TOOL is the other axis — what a PRESS means (timelineTools.ts). */
export type TimelineMode = "normal" | "select" | "move";

/**
 * `move` is a clip in hand, `sel` a rectangle drawn. A move that is PENDING — released, written,
 * waiting for the reload — is not being carried, so it does not own the keys and is not the mode.
 */
export const timelineMode = (
  move: { pending?: boolean } | null | undefined,
  sel: unknown,
): TimelineMode => (move && !move.pending ? "move" : sel ? "select" : "normal");

/** The condition name a binding reads — `{ if: "tl_select", … }`, which is the truthiness test keys.ts already does. */
export const modeCondition = (mode: TimelineMode): string => `tl_${mode}`;

/** What the mode is called on screen, and what gets you OUT of it — the convention the status line already keeps. */
export const MODE_EXIT: Record<TimelineMode, string> = {
  normal: "",
  select: "v ou esc",
  move: "enter valide · esc annule",
};
