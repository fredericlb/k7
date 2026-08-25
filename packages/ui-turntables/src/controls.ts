// controls.ts — every control on the Mix desk, by a stable id. What the project's
// `views/mix.yaml` names to bind one to a module param. See ../../docs/controls.md.

import {
  STEM_NEUTRAL,
  STEM_RANGE,
  STEMS,
  type Stem,
  stemControl,
} from "@studio/song-schema/stems";
import {
  BPM_RANGE,
  DECKS,
  ECHO_RANGE,
  EQ_DB,
  FILTER_RANGE,
  LEVEL_DB,
  MIX_CENTRE,
  TRIM_DB,
} from "./deck";

/** What each stem is called on the desk — `other` is everything the three named ones are not. */
const STEM_LABELS: Record<Stem, string> = {
  drums: "Batterie",
  bass: "Basse",
  other: "Reste",
  vocals: "Voix",
};

/** One control on the desk — `range` is the point of the whole file, see ../docs/controls.md. */
export interface MixControl {
  id: string;
  /** What it is called on screen, and in a "bind to…" menu. French, like the rest of the desk. */
  label: string;
  kind: "fader" | "button";
  /** Low and high ends, in the control's OWN units. A button is 0..1. */
  range: readonly [number, number];
  /** Where it sits with nothing done to it — what a reset returns to. */
  home: number;
  /** What KIND of module this expects to drive — a HINT for a scaffolded surface, never checked. */
  wants?: string;
}

/** The ids are ABSOLUTE — `deckA.tempo`, not a relative `deck.tempo`. See ../docs/controls.md. */
const perDeck = (deck: string, letter: string): MixControl[] => [
  {
    id: `${deck}.tempo`,
    label: `Tempo platine ${letter}`,
    kind: "fader",
    // The module's own knob, so a binding cannot offer a range the panel refuses to draw.
    range: BPM_RANGE,
    // No sensible home in BPM: a deck rests at ITS SONG's tempo, and 0 is the module's "leave alone".
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
  // The channel EQ, in DECIBELS and not 0..1 — the module's knob, so flat lands mid-travel.
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
    // One EQ module per deck, three bands on it: all three lines name it and differ by their param.
    wants: "eq",
  })),
  {
    id: `${deck}.cue`,
    label: `Casque platine ${letter}`,
    // A BUTTON, though what it drives is a gain: pre-fade listen is on or off, never dosed.
    kind: "button",
    range: [0, 1],
    // Silent at rest — a set starts with nothing in the headphones. See ../docs/cue.md.
    home: 0,
    wants: "cue",
  },
  {
    id: `${deck}.filter`,
    label: `Filtre platine ${letter}`,
    kind: "fader",
    // The module's own knob, signed — so a control mid-travel is a filter doing nothing.
    range: FILTER_RANGE,
    home: 0,
    wants: "filter",
  },
  // The GAIN STAGING, in decibels at both ends: the trim in front of the strip, the fader after it.
  {
    id: `${deck}.trim`,
    label: `Trim platine ${letter}`,
    kind: "fader",
    range: TRIM_DB,
    // Unity, and it is the CENTRE of the travel: a trim's rest is "what the record gives".
    home: 0,
    wants: "trim",
  },
  {
    id: `${deck}.level`,
    label: `Niveau platine ${letter}`,
    kind: "fader",
    range: LEVEL_DB,
    // 0 dB = unity: a channel fader rests OPEN, the crossfader deciding what is heard.
    home: 0,
    wants: "level",
  },
  {
    id: `${deck}.echo`,
    label: `Écho platine ${letter}`,
    kind: "fader",
    range: ECHO_RANGE,
    // DRY at rest — an effect must not be heard before somebody asks for it. See ../docs/fx.md.
    home: 0,
    wants: "echo",
  },
  // The STEMS: one knob per instrument, a PROPORTION, each naming its OWN node — see ../docs/stems.md.
  ...STEMS.map((stem) => ({
    id: stemControl(deck, stem),
    label: `${STEM_LABELS[stem]} platine ${letter}`,
    kind: "fader" as const,
    range: STEM_RANGE,
    // Unity is the part as it was cut, and it is the CENTRE of the travel: left removes, right adds.
    home: STEM_NEUTRAL,
    wants: "stem",
  })),
];

/** Every control, DERIVED from the decks rather than listed, so a third deck is not unbindable. */
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

/** The control an id names, or undefined — an unknown id is a typo, and the caller reports it. */
export const mixControl = (id: string): MixControl | undefined => BY_ID.get(id);

/** A control's position as 0..1 — clamped, or a param would go past the ends of the widget drawing it. */
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
