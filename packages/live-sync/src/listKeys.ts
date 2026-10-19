// listKeys.ts — which lists a path may descend into, by the natural key song's schema gives their items.
// A list is keyed only when every item is a map carrying at least one key field, each a scalar, and no two keys are equal.
// The rule that reads this table is `itemSegments` in k7xOps.ts. See ../docs/ops.md.

/** A list's map key → the fields that make one of its items unique (song-schema). */
export const LIST_KEYS: Readonly<Record<string, readonly string[]>> = {
  events: ["ref", "start"],
  notes: ["t", "k"],
  points: ["time"],
  takes: ["ref", "start"],
  comp: ["from"],
  crossfades: ["at"],
  automations: ["param"],
  subchains: ["id"],
};
