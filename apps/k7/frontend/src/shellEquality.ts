// shellEquality.ts — the "same as before?" tests the shell's setters bail on, so a child that
// re-sends an unchanged value does not re-render App (docs/audit.md, "The shell keeps still").
// A sequence's edit focus carries no text on purpose: the shell reads its path only, and text
// would make every keystroke a new state.

import type { EditTarget } from "./components/ClipView";

/** What the shell is told the editor or the timeline has in front of it: a clip, or a sequence file by path. */
export type EditFocus =
  | Extract<EditTarget, { kind: "clip" }>
  | { kind: "seq"; path: string };

/** Two foci naming the same notes: the same sequence file, or the same clip, unchanged, on the same lane. */
export function sameEditFocus(a: EditFocus, b: EditFocus): boolean {
  if (a.kind === "seq" && b.kind === "seq") return a.path === b.path;
  if (a.kind === "clip" && b.kind === "clip")
    return (
      a.track === b.track &&
      // The roll draws on the project's grid, so a tempo or metre change is a new target.
      a.project.tempo === b.project.tempo &&
      a.project.timeSigNumerator === b.project.timeSigNumerator &&
      a.project.timeSigDenominator === b.project.timeSigDenominator &&
      a.clip.id === b.clip.id &&
      JSON.stringify(a.clip) === JSON.stringify(b.clip)
    );
  return false;
}

/** Two flat records with the same keys holding identical values. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof T)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}

/** A state updater that keeps the current object when the next one says the same thing. */
export function keepIfEqual<T extends object>(next: T): (cur: T) => T {
  return (cur) => (shallowEqual(cur, next) ? cur : next);
}

/** Two JSON-shaped values (what a route answers) equal all the way down; key order does not count. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  return ka.every((k) => Object.hasOwn(rb, k) && sameJson(ra[k], rb[k]));
}

/** A state updater that keeps the current answer when a poll brings back the same one, so nothing downstream rebuilds. */
export function keepIfSame<T>(next: T): (cur: T) => T {
  return (cur) => (sameJson(cur, next) ? cur : next);
}
