// commandFill.ts — the pure half of the command bar's form: how many params a line really
// needs before it can run, and where a gesture's values land in its fields. Split out of
// CommandBar.tsx because nothing in this app mounts a component in tests.
// See docs/commandBar.md.

import type { PaletteArg } from "./components/CommandBar";
import type { ArgClass } from "./types";

/**
 * How many params must be filled before the line is runnable.
 *
 * Everything up to the last NON-optional one. Only a trailing run of optional params is
 * dropped: `a b? c` needs all three, because skipping `b` would shift `c` into its place and
 * the command would receive a value for a param the user never answered.
 */
export function requiredCount(args: readonly PaletteArg[]): number {
  let n = args.length;
  while (n > 0 && args[n - 1]?.optional) n--;
  return n;
}

/**
 * Whether a line with `filled` params answered is ready to dispatch.
 *
 * `more` is Tab rather than Enter — "there is another param I want" — which is the one point
 * the two keys differ on, and the only way to reach a trailing optional param.
 */
export function runsAfter(
  args: readonly PaletteArg[],
  filled: number,
  more: boolean,
): boolean {
  return filled >= args.length || (!more && filled >= requiredCount(args));
}

/**
 * Where a gesture's values land, keyed by param NAME.
 *
 * By name rather than by position because a gesture knows what it is holding, not where the
 * command happens to ask for it — a clip drag knows a track and two timecodes whatever order
 * `event move` lists them in.
 *
 * It fills FORWARD ONLY, from the field currently open. An answer you have already given is
 * never rewritten: type `event move ge.rythm` and the drag fills the timecodes after it,
 * leaving your track alone. Without that rule the gesture would silently replace a param you
 * chose with the one it happened to touch, which is the opposite of answering a question.
 *
 * The highest param it knows goes in the INPUT and the ones between are filled, so a live drag
 * rewrites one field while the line in front of it stays still.
 *
 * Returns null when the offer names nothing still being asked — a gesture and a command with
 * nothing to say to each other, which is the common case and not an error.
 */
export function applyOffer(
  args: readonly PaletteArg[],
  values: Readonly<Record<string, string>>,
  filled: readonly string[],
): { args: string[]; value: string } | null {
  const from = filled.length;
  let hi = -1;
  for (let i = from; i < args.length; i++)
    if (values[args[i].name] !== undefined) hi = i;
  if (hi < 0) return null;
  const out = [...filled];
  for (let i = from; i < hi; i++) out.push(values[args[i].name] ?? "");
  return { args: out, value: values[args[hi].name] ?? "" };
}

/**
 * Whether the field currently open is asking for `kind`.
 *
 * The inlet for a gesture that knows a VALUE and not a command: a click on the ruler produces a
 * timecode and has no idea which param wants one. Matching on the class the field already
 * declares is the whole check — the bar is asking for a timecode, here is a timecode.
 */
export function wantsKind(
  args: readonly PaletteArg[],
  filled: number,
  kind: ArgClass,
): boolean {
  return args[filled]?.kind === kind;
}
