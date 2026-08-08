// commandFill.ts — the pure half of the command bar's form: how many params a line really
// needs before it can run, and where a gesture's values land in its fields. Split out of
// CommandBar.tsx because nothing in this app mounts a component in tests.
// See docs/commandBar.md.

import type { PaletteArg } from "./components/CommandBar";

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
 * The highest param it knows goes in the INPUT and everything before it is filled, so a live
 * drag re-writes one field while the line in front of it stays put. By name rather than by
 * position because a gesture knows what it is holding, not where the command happens to ask
 * for it — a clip drag knows a track and two timecodes whatever their order.
 *
 * A param the offer skips keeps whatever is already in that field; it is not blanked, or a
 * gesture that knows less than the last one would quietly erase an answer.
 *
 * Returns null when the offer names nothing this command asks for — a gesture and a command
 * that have nothing to say to each other, which is the common case and not an error.
 */
export function applyOffer(
  args: readonly PaletteArg[],
  values: Readonly<Record<string, string>>,
  current: readonly string[],
): { args: string[]; value: string } | null {
  let hi = -1;
  for (let i = 0; i < args.length; i++)
    if (values[args[i].name] !== undefined) hi = i;
  if (hi < 0) return null;
  const filled: string[] = [];
  for (let i = 0; i < hi; i++)
    filled.push(values[args[i].name] ?? current[i] ?? "");
  return { args: filled, value: values[args[hi].name] ?? "" };
}
