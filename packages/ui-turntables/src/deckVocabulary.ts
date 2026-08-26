// deckVocabulary.ts — what a deck IS, and the ends of every knob the desk draws over it: the two
// deck names, what one is holding, what it is playing at, and the ranges those controls run over.
// Declarations and one ratio, no document work — so `deck.ts` (which builds the document) and
// `metronome.ts` (which builds the click) can both read it without importing each other.
// See docs/mix.md.

import type { WebModuleCategory } from "@studio/graph-model";

/** A module the deck runs, as the desk holds it: a médiathèque ref plus what it plays as. */
export interface DeckModule {
  /** The node name, which is also the engine's `chain:module` address. */
  name: string;
  /** Its type folder, which is what picks the node's glyph. */
  category: WebModuleCategory;
  /** The engine plugin behind it, read from the module file's `plugin:` block. */
  plugin: { type?: string; name?: string } | undefined;
  enabled: boolean;
}

/** The two decks, named as the PROJECT names them (`chains.yaml`) — not a cosmetic match, see docs/mix.md. */
export const DECKS = ["deckA", "deckB"] as const;
export type DeckId = (typeof DECKS)[number];

/** What a deck is holding: a file the engine can open, and who to say it is. */
export interface DeckLoad {
  /** Absolute, on the ENGINE's machine — the engine opens paths, never URLs. */
  path: string;
  title: string;
  artist: string | null;
  /** The médiathèque id, so a surface can tell which set-list row is on which deck. */
  id: string;
  /** Whether `stems/` holds this song's four files — a fact about the disk, answered by whoever loads it. */
  stems?: boolean;
  /** What PL8 knows about the recording, from its `song.yaml` — see mediatek's docs/songs.md.
   *
   * Both are facts about the RECORD and not about this set, which is why they arrive with the load
   * rather than out of `mix.yaml`: 87 BPM is 87 BPM in every project that plays it. */
  bpm?: number;
  /** `C# minor`. Typed by a person — the detector measured 53 % (docs/key-detection-plan.md). */
  key?: string;
}

export type DeckLoads = Record<DeckId, DeckLoad | null>;
export const NO_LOADS: DeckLoads = { deckA: null, deckB: null };

/** The crossfader's middle — both decks at once, which is where a set starts. */
export const MIX_CENTRE = 0.5;

/** The tempo the TIMELINE runs at. Fixed, and that is the whole trick — each deck warps its own clip. */
export const DOC_TEMPO = 120;

/** How far a tempo bends either way, ±16 % — beyond it a stretch stops sounding like the record. */
export const PITCH_RANGE = 0.16;

/** The module a deck's tempo BELONGS to, and the params the faders are — `offline`, so the platter's `Rate` realises it. */
export const TEMPO_MODULE = "@st0/audio/utility/tempo";
export const TEMPO_PARAM = "Target BPM";
export const TEMPO_SOURCE_PARAM = "Source BPM";

/** What one deck is playing at: the song's own tempo, its length, and where the fader is. */
export interface DeckTempo {
  /** The engine's estimate for this song, or 0 when it found none. */
  natural: number;
  /** The song's length in seconds — the second half of a warp marker. */
  seconds: number;
  /** What it should PLAY at. Equal to `natural` until somebody moves the fader. */
  target: number;
  /** Where this song's beat grid starts, in SOURCE seconds — a fact about the file, never moved by a fader. */
  phase?: number;
  /** Hold the PITCH while the tempo moves? Off is a platter's own behaviour, and the default — docs/bpm.md. */
  keylock?: boolean;
}

export type DeckTempos = Partial<Record<DeckId, DeckTempo>>;

/** The ends of the tempo fader — the MODULE's own knob (`ui.yaml`), not a range the desk invented. See docs/bpm.md. */
export const BPM_RANGE: readonly [min: number, max: number] = [10, 300];

/** The ends of an EQ knob, in dB — the module's own, for the same reason `BPM_RANGE` is. See docs/eq.md. */
export const EQ_DB: readonly [min: number, max: number] = [-20, 20];

/** The ends of a deck's filter knob — one signed param, so the neutral is the middle. See docs/filter.md. */
export const FILTER_RANGE: readonly [min: number, max: number] = [-100, 100];

/** The ends of the input TRIM, in dB — the `trim` module's own knob, signed so unity is mid-travel. */
export const TRIM_DB: readonly [min: number, max: number] = [-12, 12];

/** …and of the CHANNEL FADER, in dB. The bottom is SILENCE and not -Infinity — docs/mix.md. */
export const LEVEL_DB: readonly [min: number, max: number] = [-60, 6];

/** The echo's amount, dry to fully wet — the `echo` module's `Mix`. See docs/fx.md. */
export const ECHO_RANGE: readonly [min: number, max: number] = [0, 1];

/** How fast a record runs backwards under the CENSOR — a platter rate, so 1 is its own speed. */
export const CENSOR_RATE = -1;

/** The three bands a deck's EQ strip draws, low to high — the order they sit in. */
export const EQ_BANDS = [
  { id: "eqLow", label: "GRAVE" },
  { id: "eqMid", label: "MÉDIUM" },
  { id: "eqHigh", label: "AIGU" },
] as const;

/** A colour per cue BUTTON rather than per cue, kept away from the readout's amber — see docs/cues.md. */
export const CUE_COLOURS = [
  "#ef4444", // rouge
  "#f97316", // orange
  "#eab308", // jaune
  "#22c55e", // vert
  "#14b8a6", // turquoise
  "#3b82f6", // bleu
  "#a855f7", // violet
  "#ec4899", // rose
] as const;

/** The stretch, as a multiplier of the file's own clock. 1 when either end is unknown. */
export function ratioOf(natural: number, target: number): number {
  return natural > 0 && target > 0 ? natural / target : 1;
}
