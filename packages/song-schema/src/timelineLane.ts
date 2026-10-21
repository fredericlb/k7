// timelineLane.ts — the address of a TIMELINE's lane, `<timeline>><lane>`, which every event verb
// takes where it takes a project lane. No imports, so a browser holds the rule too. What a reader
// gets wrong: `>` is chosen because no file name holds it — a project lane can never look like one.

/** What separates a timeline from its lane, and the timelines a nested clip's id walks through. */
export const NEST_SEP = ">";

/** The word for the project's own timeline, `Main` on screen — `timeline lane copy`'s destination, and no timeline's name. */
export const SONG_TARGET = "main";

/** The placement fields a timeline event may not carry: its extent is its timeline's, fixed. */
export const FIXED_FIELDS = [
  "from",
  "to",
  "loop",
  "fadeIn",
  "fadeOut",
  "warp",
  "takes",
  "comp",
  "crossfades",
] as const;

/** The address of lane `lane` of timeline `timeline`. */
export const timelineLaneId = (timeline: string, lane: string): string =>
  `${timeline}${NEST_SEP}${lane}`;

/** The timeline and lane an address names, or null for a project lane. */
export function timelineLaneOf(
  id: string,
): { timeline: string; lane: string } | null {
  const at = id.indexOf(NEST_SEP);
  if (at <= 0 || at === id.length - 1) return null;
  return { timeline: id.slice(0, at), lane: id.slice(at + 1) };
}
