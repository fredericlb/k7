// metronome.ts — the desk's CLICK, as a track in the deck document. Its own track and not the
// engine's metronome, because the engine clicks on the DOCUMENT's grid while the music's beat is
// somewhere else entirely: the click is a clip warped onto whichever deck leads. See docs/bpm.md.

import {
  clipDoc,
  MIXER_PLUGIN,
  pluginDoc,
  trackDoc,
} from "@studio/engine-protocol/build";
import type { ClipDoc, TrackDoc } from "@studio/engine-protocol/project";
import { BEATS_PER_BAR } from "./beats";
import {
  DECKS,
  type DeckId,
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  DOC_TEMPO,
  ratioOf,
} from "./deckVocabulary";

/** The track the click lives on. Always in the document — see `metronomeTrack`. */
export const METRONOME_TRACK = "metronome";

/** How loud the click sits under the music, in dB on its own strip. */
const METRONOME_DB = -6;

/** WHICH deck's beat the click follows, or null: a click needs ONE beat, and a MEASURED one — docs/metronome.md. */
export function metronomeDeck(
  loads: DeckLoads,
  tempos: DeckTempos,
  master: DeckId | null,
): DeckId | null {
  const on = DECKS.filter((d) => loads[d]);
  const deck =
    on.length === 1 ? on[0] : master && loads[master] ? master : null;
  if (!deck) return null;
  const t = tempos[deck];
  return t && t.natural > 0 && t.target > 0 && t.phase !== undefined
    ? deck
    : null;
}

/** The click as a TRACK, never removed from the document — not the engine's own metronome, docs/metronome.md. */
export function metronomeTrack(
  tempo: DeckTempo | undefined,
  on: boolean,
): TrackDoc {
  const bar = tempo && on ? clickBar(tempo) : null;
  return trackDoc(METRONOME_TRACK, {
    name: "metronome",
    clips: bar ? [bar] : [],
    plugins: [
      pluginDoc({
        id: `${METRONOME_TRACK}:synth`,
        type: "4osc",
        name: "click",
        // A click is an envelope, not a waveform: instant on, gone in thirty milliseconds.
        params: {
          "Amp Attack": 0.001,
          "Amp Decay": 0.03,
          "Amp Sustain": 0,
          "Amp Release": 0.03,
          "Filter Amount": 0,
        },
        role: "instrument",
      }),
      pluginDoc({
        id: `${METRONOME_TRACK}:level`,
        type: MIXER_PLUGIN,
        name: "metronome level",
        params: { Volume: METRONOME_DB },
      }),
    ],
  });
}

/** One looping bar of clicks at the deck's SPACING, from the transport's zero — no phase, docs/metronome.md. */
function clickBar(tempo: DeckTempo): ClipDoc {
  const toBeats = (seconds: number) => (seconds * DOC_TEMPO) / 60;
  // Document beats are a unit of TIME here: one beat of the DECK lasts 60/target seconds.
  const beat = DOC_TEMPO / tempo.target;
  // As long as the record PLAYS for, so the click stops rather than outliving it.
  const span = Math.max(
    beat,
    toBeats(tempo.seconds * ratioOf(tempo.natural, tempo.target)),
  );
  return clipDoc({
    id: `${METRONOME_TRACK}-clip`,
    type: "midi",
    name: "click",
    start: 0,
    length: span,
    // Four notes and a loop rather than one per beat: the clip is rebuilt on every step of a drag.
    loopStart: 0,
    loopEnd: BEATS_PER_BAR * beat,
    notes: Array.from({ length: BEATS_PER_BAR }, (_, i) => ({
      time: i * beat,
      duration: beat / 4,
      key: i === 0 ? 96 : 89, // the bar's first beat sounds different — that IS the feature
      vel: i === 0 ? 1 : 0.7,
      rel: 0,
      channel: 1,
    })),
  });
}
