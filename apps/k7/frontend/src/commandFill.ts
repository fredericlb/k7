// commandFill.ts — the pure half of the command bar's parameter FORM: how many params a line
// really needs before it can run, whether it can run yet, and where a gesture's values land in
// its fields. Split out of CommandBar.tsx because nothing in this app mounts a component in
// tests. See docs/commandBar.md.
//
// The model is a form, not a queue: `values` has one slot per param — "" meaning unanswered —
// and `active` is the field with the keyboard. The params share a popin, all on screen at once
// with Tab walking between them, and a queue cannot express "go back and change the second one".

import type { PaletteArg } from "./components/CommandBar";
import type { ArgClass } from "./types";

/** How many params must be filled before the line is runnable — everything up to the last NON-optional one, since skipping shifts the rest. */
export function requiredCount(args: readonly PaletteArg[]): number {
  let n = args.length;
  while (n > 0 && args[n - 1]?.optional) n--;
  return n;
}

/** A fresh, empty answer sheet — one slot per param, so a field can be filled out of order. */
export function emptyValues(args: readonly PaletteArg[]): string[] {
  return args.map(() => "");
}

/** Whether the line can be dispatched as it stands: a trailing optional left blank is the answer 'not that', not an omission. */
export function canRun(
  args: readonly PaletteArg[],
  values: readonly string[],
): boolean {
  const need = requiredCount(args);
  for (let i = 0; i < need; i++) if (!values[i]?.trim()) return false;
  return true;
}

/** The line's arguments, trailing blanks dropped — a blank in the MIDDLE is kept, or the params after it would shift one place left. */
export function lineArgs(values: readonly string[]): string[] {
  const out = [...values];
  while (out.length && !out[out.length - 1]?.trim()) out.pop();
  return out.map((v) => v ?? "");
}

/** The next field after `from` — the last one stays put, so Tab cannot walk off the form. */
export function nextField(args: readonly PaletteArg[], from: number): number {
  return Math.min(from + 1, Math.max(0, args.length - 1));
}

/** The first field still unanswered, or -1 when the form is complete — what Enter uses when the line is not runnable yet. */
export function firstMissing(
  args: readonly PaletteArg[],
  values: readonly string[],
): number {
  const need = requiredCount(args);
  for (let i = 0; i < need; i++) if (!values[i]?.trim()) return i;
  return -1;
}

/** Where a gesture's values land, keyed by param NAME, filling FORWARD ONLY from the field with the keyboard — null when nothing matches. */
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

/** What the timeline CARET is looking at, in the vocabulary a command line speaks — timecodes rather than beats. */
export interface CaretAim {
  /** The track it is on. Null on a video lane, a group header, or nothing at all. */
  track: string | null;
  /** Where it is. Null when it is parked on a row's label rather than in time. */
  at: string | null;
  /** Where the event UNDER it starts — how every `event` verb addresses one. Null on bare lane. */
  eventStart: string | null;
  /** The lanes the rectangle covers, comma-joined, and its span — EVERY lane it touched, since the verb is what must refuse two. */
  selTracks: string | null;
  selFrom: string | null;
  selTo: string | null;
}

/** Which caret facts answer which of a command's params, by param NAME — an EXPLICIT list, or a caret would pre-answer every destructive verb. */
const CARET_ANSWERS: Record<string, Partial<Record<string, keyof CaretAim>>> = {
  // The verb this exists for: the event is addressed by its start, and the cut is its own argument, which is what the caret gives.
  "event split": { track: "track", timecode: "eventStart", at: "at" },
  // Split's inverse, answered by the RECTANGLE — `tracks` carries every lane it covered, since the handler is what refuses two.
  "selection consolidate": {
    tracks: "selTracks",
    from: "selFrom",
    to: "selTo",
  },
  // Only `at`: these two are project-wide, so making the length the hole is what keeps the gesture deliberate.
  "project add": { at: "at" },
  "project remove": { at: "at" },
};

/** The caret's answers to one command, ready for `applyOffer` — a fact it cannot supply is absent, so the form still opens on it. */
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

/** Whether the field with the keyboard is asking for `kind` — the inlet for a gesture that knows a VALUE and not a command. */
export function wantsKind(
  args: readonly PaletteArg[],
  active: number,
  kind: ArgClass,
): boolean {
  return args[active]?.kind === kind;
}

/** What Enter does in the parameter form: a highlighted suggestion first, but ONLY when it would change the field, or Enter is eaten for ever. */
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
