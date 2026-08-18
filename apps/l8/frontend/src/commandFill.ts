// commandFill.ts — the pure half of the command bar's parameter FORM: how many params a line
// really needs before it can run, whether it can run yet, and where a gesture's values land in
// its fields. Split out of CommandBar.tsx because nothing in this app mounts a component in
// tests. See docs/commandBar.md.
//
// The model is a form, not a queue: `values` has one slot per param — "" meaning unanswered —
// and `active` is the field with the keyboard. It was a queue (params answered in order, one
// input) until the params moved into their own popin, where they are all on screen at once and
// Tab walks between them; a queue cannot express "go back and change the second one".

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

/** A fresh, empty answer sheet — one slot per param, so a field can be filled out of order. */
export function emptyValues(args: readonly PaletteArg[]): string[] {
  return args.map(() => "");
}

/**
 * Whether the line can be dispatched as it stands: every required param answered.
 *
 * A trailing optional one left blank is not an omission, it is the answer "not that" — which is
 * why `event move` runs on three params although its fourth exists.
 */
export function canRun(
  args: readonly PaletteArg[],
  values: readonly string[],
): boolean {
  const need = requiredCount(args);
  for (let i = 0; i < need; i++) if (!values[i]?.trim()) return false;
  return true;
}

/**
 * The line's arguments, trailing blanks dropped.
 *
 * A blank in the MIDDLE is kept as an empty token — it would otherwise shift the params after
 * it one place left, and the command would read someone's track name as a timecode. `canRun`
 * is what stops that line being dispatched at all; this only decides how it is spelled.
 */
export function lineArgs(values: readonly string[]): string[] {
  const out = [...values];
  while (out.length && !out[out.length - 1]?.trim()) out.pop();
  return out.map((v) => v ?? "");
}

/** The next field after `from` — the last one stays put, so Tab cannot walk off the form. */
export function nextField(args: readonly PaletteArg[], from: number): number {
  return Math.min(from + 1, Math.max(0, args.length - 1));
}

/**
 * The first field still unanswered, or -1 when the form is complete.
 *
 * What Enter uses when the line is not runnable yet: it moves to the question that is actually
 * missing rather than refusing silently, which is the difference between a form that guides and
 * a form that sulks.
 */
export function firstMissing(
  args: readonly PaletteArg[],
  values: readonly string[],
): number {
  const need = requiredCount(args);
  for (let i = 0; i < need; i++) if (!values[i]?.trim()) return i;
  return -1;
}

/**
 * Where a gesture's values land, keyed by param NAME.
 *
 * By name rather than by position because a gesture knows what it is holding, not where the
 * command happens to ask for it — a clip drag knows a track and two timecodes whatever order
 * `event move` lists them in.
 *
 * It fills FORWARD ONLY, from the field with the keyboard. An answer you have already given is
 * never rewritten: type `event move` , put ge.rythm in its track field, and the drag fills the
 * timecodes after it, leaving your track alone. Without that rule the gesture would silently
 * replace a param you chose with the one it happened to touch, which is the opposite of
 * answering a question.
 *
 * The keyboard follows to the highest field it filled, so the next Enter is about the value the
 * gesture just put down.
 *
 * Returns null when the offer names nothing this form is still asking for — a gesture and a
 * command with nothing to say to each other, which is the common case and not an error.
 */
export function applyOffer(
  args: readonly PaletteArg[],
  offered: Readonly<Record<string, string>>,
  values: readonly string[],
  active: number,
): { values: string[]; active: number } | null {
  const out = [...values];
  let hi = -1;
  for (let i = Math.max(0, active); i < args.length; i++) {
    const v = offered[args[i].name];
    if (v === undefined) continue;
    out[i] = v;
    hi = i;
  }
  return hi < 0 ? null : { values: out, active: hi };
}

/**
 * What the timeline CARET is looking at, in the vocabulary a command line speaks.
 *
 * Timecodes rather than beats, because that is what an argument of class `timecode` holds — the
 * conversion needs the time signature and belongs where the grid is drawn (`TimelineTab`'s
 * `onCaret`), not here and not in a handler.
 */
export interface CaretAim {
  /** The track it is on. Null on a video lane, a group header, or nothing at all. */
  track: string | null;
  /** Where it is. Null when it is parked on a row's label rather than in time. */
  at: string | null;
  /** Where the event UNDER it starts — how every `event` verb addresses one. Null on bare lane. */
  eventStart: string | null;
  /**
   * The lanes the selection rectangle covers, comma-joined, and its span. Null when none is drawn.
   *
   * `tracks` keeps EVERY lane the rectangle touched, several included. A verb that only works on
   * one is the one that has to say so — dropping the extras here would turn "you selected two
   * lanes" into a command that silently acted on whichever came first.
   */
  selTracks: string | null;
  selFrom: string | null;
  selTo: string | null;
}

/**
 * Which caret facts answer which of a command's params, per command — **by param NAME**.
 *
 * The same key `applyOffer` uses, and for the same reason: a source knows what it is holding, not
 * where a command happens to ask for it. So this table says nothing about order or arity, and a
 * command that grows an argument keeps working.
 *
 * An EXPLICIT list, not "fill anything called `track`". A caret is always somewhere, so a blanket
 * rule would silently pre-answer `track delete` and `event remove` with whatever the caret last
 * touched — and a form that opens already complete is one Enter from doing it. Every entry here is
 * a command where acting on what you are looking at IS the intent.
 */
const CARET_ANSWERS: Record<string, Partial<Record<string, keyof CaretAim>>> = {
  // The verb this exists for. `commands.yaml` has said so since it was written: the event is
  // addressed by its start, "the cut is its own argument, which is what the caret gives".
  "event split": { track: "track", timecode: "eventStart", at: "at" },
  // Split's inverse, answered by the RECTANGLE rather than by where the caret sits — what to
  // rejoin is a range, and a range is what you drew. `tracks` carries every lane it covered,
  // including two: the handler refuses that, and it has to be able to, so nothing is dropped here.
  "event join": { tracks: "selTracks", from: "selFrom", to: "selTo" },
};

/**
 * The caret's answers to one command, ready for `applyOffer`. Empty when it has none.
 *
 * A fact the caret cannot supply is simply absent, so a form still opens on it: park on empty
 * lane and `event split` arrives knowing the track and the cut, asking only which event.
 */
export function caretAnswers(
  canonical: string,
  caret: CaretAim | null,
): Record<string, string> {
  const wanted = caret && CARET_ANSWERS[canonical];
  if (!wanted) return {};
  const out: Record<string, string> = {};
  for (const [param, fact] of Object.entries(wanted)) {
    const v = fact && caret[fact];
    if (v) out[param] = v;
  }
  return out;
}

/**
 * Whether the field with the keyboard is asking for `kind`.
 *
 * The inlet for a gesture that knows a VALUE and not a command: a click on the ruler produces a
 * timecode and has no idea which param wants one. Matching on the class the field already
 * declares is the whole check — the bar is asking for a timecode, here is a timecode.
 */
export function wantsKind(
  args: readonly PaletteArg[],
  active: number,
  kind: ArgClass,
): boolean {
  return args[active]?.kind === kind;
}

/**
 * What Enter does in the parameter form — the three answers, and the order between them.
 *
 * A highlighted suggestion is taken first, because completion is the validation. But ONLY when
 * it would change the field: an exact match still ranks first (see `rankValues`), so once the
 * field holds the suggestion the list is still on screen — and taking it again is a no-op.
 * Without that clause Enter is eaten for ever, and a form whose last field has a vocabulary
 * (`node replace <node> <extends-ref>`) can never be submitted at all: the reported bug.
 */
export type EnterAction =
  | { kind: "take"; value: string }
  | { kind: "run" }
  | { kind: "goto"; index: number }
  | { kind: "none" };

export function enterAction(
  args: readonly PaletteArg[],
  values: readonly string[],
  active: number,
  /** The highlighted suggestion, or undefined when the field lists none. */
  suggestion: string | undefined,
): EnterAction {
  if (suggestion !== undefined && suggestion !== (values[active] ?? ""))
    return { kind: "take", value: suggestion };
  if (canRun(args, values)) return { kind: "run" };
  const missing = firstMissing(args, values);
  return missing >= 0 ? { kind: "goto", index: missing } : { kind: "none" };
}
