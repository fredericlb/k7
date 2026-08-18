// controls.ts — every control on the Mix desk, by a stable id. What the project's
// `views/mix.yaml` names to bind one to a module param. See ../../docs/controls.md.

import { BPM_RANGE, DECKS, EQ_DB, FILTER_RANGE, MIX_CENTRE } from "./deck";

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
  /**
   * What KIND of module this control expects to drive, in one word, for a scaffolded surface to
   * say beside the line you have to fill in.
   *
   * A hint and not a check. Nothing verifies it — a set is free to wire a fader to whatever it
   * likes, and `resolveBindings` only asks whether the named module EXISTS. It is here because
   * `deckA.eqLow:` on its own tells you nothing about what belongs on the other side, and the
   * answer is a fact about the desk rather than about any one project.
   *
   * Absent for the controls that drive no param at all — `transport`, `sync`, `listen` — which
   * is the same line `REQUIRED_CONTROLS` draws, from the same fact.
   */
  wants?: string;
}

/**
 * The ids are ABSOLUTE — `deckA.tempo`, not a relative `deck.tempo`.
 *
 * They were relative for one turn, and the reason is worth keeping because it says what
 * changed: a `controller.yaml` belongs to a MODULE and is shared by every node of it, so
 * a set with a tempo module on each deck has ONE map for both, and `deckA.tempo` in it would
 * have driven deck B's stretch from deck A's fader.
 *
 * The bindings live in the PROJECT now (`views/mix.yaml`), which can name each node
 * outright — `tempoA` and `tempoB` are different lines. So there is nothing left to resolve,
 * and an id that means exactly one control beats one that means "whichever deck you are".
 */
const perDeck = (deck: string, letter: string): MixControl[] => [
  {
    id: `${deck}.tempo`,
    label: `Tempo platine ${letter}`,
    kind: "fader",
    // The module's own knob, so a binding cannot offer a range the panel refuses to draw.
    range: BPM_RANGE,
    // No sensible home in BPM: a deck's rest position is ITS SONG's tempo, which is a fact
    // about what is loaded rather than about the control. 0 is the tempo module's own "leave
    // it alone", which is the honest stand-in.
    home: 0,
    wants: "tempo",
  },
  {
    id: `${deck}.sync`,
    label: `Sync platine ${letter}`,
    kind: "button",
    range: [0, 1],
    home: 0,
  },
  // The channel EQ, in DECIBELS and not 0..1. Same rule as the mixer strip's Volume: a
  // control that sent 0.5 for "half" would look right and be six decibels wrong. The range is
  // the module's knob, so 0 dB — flat — lands exactly at the middle of the travel.
  ...(
    [
      ["eqLow", "Grave"],
      ["eqMid", "Médium"],
      ["eqHigh", "Aigu"],
    ] as const
  ).map(([suffix, band]) => ({
    id: `${deck}.${suffix}`,
    label: `${band} platine ${letter}`,
    kind: "fader" as const,
    range: EQ_DB,
    home: 0,
    // One EQ module per deck, three bands on it — so all three lines name the same module and
    // differ by their param, which is what a skeleton has to make obvious.
    wants: "eq",
  })),
  {
    id: `${deck}.filter`,
    label: `Filtre platine ${letter}`,
    kind: "fader",
    // The module's own knob. Signed, so a control at the middle of its travel is a filter that
    // is doing nothing — the same reading an EQ gain gets.
    range: FILTER_RANGE,
    home: 0,
    wants: "filter",
  },
];

/**
 * Every control, DERIVED from the decks rather than listed.
 *
 * A third deck is a third track and a second meeting point in the file format, and nothing in
 * m9 hardcodes two — so the desk's controls must not either, or adding a deck would silently
 * leave it unbindable.
 */
export const MIX_CONTROLS: readonly MixControl[] = [
  {
    id: "crossfade",
    label: "Crossfade",
    kind: "fader",
    range: [0, 1],
    home: MIX_CENTRE,
    wants: "crossfade",
  },
  ...DECKS.flatMap((d, i) => perDeck(d, String.fromCharCode(65 + i))),
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
];

const BY_ID = new Map(MIX_CONTROLS.map((c) => [c.id, c]));

/** The control an id names, or undefined. A binding to an unknown id is a typo, and the
 *  caller reports it rather than silently doing nothing. */
export const mixControl = (id: string): MixControl | undefined => BY_ID.get(id);

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
