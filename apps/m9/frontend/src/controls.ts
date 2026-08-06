// controls.ts — every control on the Mix desk, by a stable id. What a `controller.yaml` will
// name to bind one to a module param, the way it already names a MIDI `ch`/`cc`.
// See ../../docs/controls.md.

import { BPM_RANGE, MIX_CENTRE } from "./deck";

/**
 * One control on the desk.
 *
 * `range` is the point of the whole file. A binding has to turn "where this control is" into
 * "what that param should be", and the only way to do that without inventing a scale is to
 * normalise the control to 0..1 and let the target widget's own min/max expand it — which is
 * exactly the journey a MIDI CC's 0..127 already makes in l8's `useMidiControl`. A control
 * that did not state its range would force every consumer to guess one.
 */
export interface MixControl {
  id: string;
  /** What it is called on screen, and in a "bind to…" menu. French, like the rest of m9. */
  label: string;
  kind: "fader" | "button";
  /** Low and high ends, in the control's OWN units. A button is 0..1. */
  range: readonly [number, number];
  /** Where it sits with nothing done to it — what a reset returns to. */
  home: number;
}

/**
 * The ids are of TWO kinds, and the difference is not cosmetic.
 *
 * A `controller.yaml` belongs to a MODULE and is shared by every instance of it — that is
 * stated in its own doc, and it is what makes a map travel with the device. So a set with a
 * tempo module on each deck has ONE map for both, and a binding that named `deckA.tempo`
 * outright would drive deck B's stretch from deck A's fader.
 *
 * Hence:
 *
 * - **desk-wide** (`crossfade`, `transport`, `listen`) — one control, no ambiguity.
 * - **per-deck and RELATIVE** (`deck.tempo`, `deck.sync`) — "the deck this instance is on",
 *   resolved against the chain the step sits in. One map, two decks, each answering to its own
 *   hand.
 *
 * `deck.` is the prefix that says "resolve me"; nothing else may start with it.
 */
export const DECK_PREFIX = "deck.";

export const MIX_CONTROLS: readonly MixControl[] = [
  {
    id: "crossfade",
    label: "Crossfade",
    kind: "fader",
    range: [0, 1],
    home: MIX_CENTRE,
  },
  {
    id: "deck.tempo",
    label: "Tempo de la platine",
    kind: "fader",
    // The module's own knob, so a binding cannot offer a range the panel refuses to draw.
    range: BPM_RANGE,
    // No sensible home in BPM: a deck's rest position is ITS SONG's tempo, which is a fact
    // about what is loaded rather than about the control. 0 is the tempo module's own "leave
    // it alone", which is the honest stand-in.
    home: 0,
  },
  {
    id: "deck.sync",
    label: "Sync de la platine",
    kind: "button",
    range: [0, 1],
    home: 0,
  },
  {
    id: "transport",
    label: "Lecture / arrêt",
    kind: "button",
    range: [0, 1],
    home: 0,
  },
  {
    id: "listen",
    label: "Écouter ici",
    kind: "button",
    range: [0, 1],
    home: 0,
  },
] as const;

const BY_ID = new Map(MIX_CONTROLS.map((c) => [c.id, c]));

/** The control an id names, or undefined. A binding to an unknown id is a typo, and the
 *  caller reports it rather than silently doing nothing. */
export const mixControl = (id: string): MixControl | undefined => BY_ID.get(id);

/** True for an id that has to be resolved against a deck before it means anything. */
export const isPerDeck = (id: string): boolean => id.startsWith(DECK_PREFIX);

/**
 * A control's position as 0..1, which is what a binding hands on.
 *
 * Clamped, and deliberately: a value from outside the control's range is a caller's mistake,
 * and letting it through would push a param past the ends of the widget that draws it — a
 * knob pinned at its limit while the number says something else.
 */
export function normalise(control: MixControl, value: number): number {
  const [lo, hi] = control.range;
  if (!(hi > lo)) return 0;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

/** …and back, for a control being DRIVEN — the echo half, once a param can move a fader. */
export function denormalise(control: MixControl, unit: number): number {
  const [lo, hi] = control.range;
  return lo + Math.min(1, Math.max(0, unit)) * (hi - lo);
}
