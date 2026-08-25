// deck.ts — the two decks as ONE document the engine plays: a track each, a level each, and
// the crossfade between them. The engine has one transport, so both decks run off it and the
// crossfader decides what is heard. See docs/mix.md.

import type { EngineClient } from "@studio/engine-browser";
import {
  clipDoc,
  emptyDoc,
  enginePlugin,
  MIXER_PLUGIN,
  pluginDoc,
  trackDoc,
  VOLUME_DB,
} from "@studio/engine-protocol/build";
import type {
  ClipDoc,
  ProjectDoc,
  TrackDoc,
} from "@studio/engine-protocol/project";
import {
  STEMS,
  STEMS_DIR,
  type Stem,
  stemFile,
  stemLane,
  stemLaneOf,
} from "@studio/song-schema/stems";
import { BEATS_PER_BAR } from "./beats";
import type { DeckModule } from "./graph";

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
function ratioOf(natural: number, target: number): number {
  return natural > 0 && target > 0 ? natural / target : 1;
}

/** How often a scratch may reach the engine. A pointer moves far faster than an ear hears — docs/scratch.md. */
export const SCRATCH_MS = 16;

/** How long to hold this scratch: 0 goes now. A RELEASE never waits, since it hands the record back. */
export function scratchDelay(
  sinceLast: number,
  rate: number | null,
  every: number = SCRATCH_MS,
): number {
  if (rate === null) return 0;
  return Math.max(0, every - sinceLast);
}

/** A deck's linear gain at crossfade `mix` — equal GAIN, the same law the project's module writes (docs/mix.md). */
export function deckGain(deck: DeckId, mix: number): number {
  const clamped = Math.min(1, Math.max(0, mix));
  return deck === "deckA" ? 1 - clamped : clamped;
}

/** A linear gain as the decibels a strip's `Volume` takes — silence is the FLOOR, not -Infinity. */
export function gainToDb(gain: number): number {
  if (gain <= 0) return VOLUME_DB.min;
  return Math.max(
    VOLUME_DB.min,
    Math.min(VOLUME_DB.max, 20 * Math.log10(gain)),
  );
}

/** The id of the level at the end of a deck's chain — the thing the crossfader moves. */
export const levelId = (deck: DeckId): string => `${deck}:level`;

/** `stems/` beside a record — string work, not a path join: the path is the ENGINE machine's. */
function stemsFolder(master: string): string {
  const cut = Math.max(master.lastIndexOf("/"), master.lastIndexOf("\\"));
  return `${cut < 0 ? "" : master.slice(0, cut + 1)}${STEMS_DIR}/`;
}

/** One stem's file beside its record. */
export function stemSource(master: string, stem: Stem): string {
  return `${stemsFolder(master)}${stemFile(stem)}`;
}

/** The engine's platter, as a module id on a TRACK — the deck's own lane, or one of its stem lanes. */
export const PLATTER_TYPE = "studio_turntable";
export const platterId = (track: string): string => `${track}:platter`;

/** Every platter a deck drives, in the order the parts are named. Empty when it holds nothing.
 *
 * A separated record is FOUR platters and not one: the four parts ARE the record, so they share one
 * position, one rate and one KEY, and a gesture reaches all of them. See docs/stems.md. */
export function plattersOf(deck: DeckId, load?: DeckLoad | null): string[] {
  if (!load) return [];
  return load.stems
    ? STEMS.map((s) => platterId(stemLane(deck, s)))
    : [platterId(deck)];
}

/** How fast a platter runs, as a multiple of the record's own clock. 0 when stopped.
 *
 * `target / natural` and not the other way round: a 120 song asked to play at 60 runs at HALF speed.
 * The inverse is the STRETCH, which is what the clip path wanted and what got this backwards once. */
export function platterRate(
  tempo: DeckTempo | undefined,
  playing: boolean,
): number {
  if (!playing) return 0;
  return ratioOf(tempo?.target ?? 0, tempo?.natural ?? 0);
}

/** What a platter's `Key` should be: 1 holds the pitch, 0 lets it follow the speed.
 *
 * A hand on the record wins over the switch, and that is not a compromise — a scratch CHANGES pitch,
 * that is the sound of the gesture. See packages/ui-turntables/docs/scratch.md. */
export function platterKey(
  tempo: DeckTempo | undefined,
  /** Is a hand holding the record right now? */
  holding: boolean,
): number {
  return !holding && tempo?.keylock ? 1 : 0;
}

/** Which decks are turning. A platter carries its own transport, so this is PER DECK — docs/turntable.md. */
export type DeckPlaying = Partial<Record<DeckId, boolean>>;

/** Is this deck running? Its own answer: every loaded deck plays off platters, which the transport
 *  does not command. An empty one is not running, whatever the transport is doing. */
export function deckRunning(
  deckId: DeckId,
  own: DeckPlaying,
  load?: DeckLoad | null,
): boolean {
  return !!load && !!own[deckId];
}

/** The platter plugin for one LANE, carrying the record it OWNS — `role: instrument`, it makes its own audio. */
function platterPlugin(
  track: string,
  source: string,
  tempo: DeckTempo | undefined,
  playing: boolean,
) {
  return pluginDoc({
    id: platterId(track),
    type: PLATTER_TYPE,
    name: "platter",
    role: "instrument",
    deckFile: source,
    // Seek is left alone here: a jump is a live message, and re-sending the document must not re-drop the needle.
    params: {
      Rate: platterRate(tempo, playing),
      Gain: 1,
      // KEY is a param of the platter, not a second way of playing — engine/moteur/docs/turntable.md.
      // No hand here: a document is what the deck does when nobody is touching it.
      Key: platterKey(tempo, false),
    },
  });
}

/** The COMPILED project with the decks' songs filled in — everything else is left ALONE, docs/mix.md. */
export function withDecks(
  compiled: ProjectDoc,
  loads: DeckLoads,
  tempos: DeckTempos = {},
  /** Which deck's beat the click follows, or null for no click — see `metronomeDeck`. */
  click: DeckId | null = null,
  /** WHICH decks are turning: a platter has its own transport, so one flag for both would not do. */
  playing: DeckPlaying = {},
): ProjectDoc {
  return {
    ...compiled,
    // The click is APPENDED, not declared: it is a desk control, not part of the set.
    tracks: [
      ...compiled.tracks,
      metronomeTrack(click ? tempos[click] : undefined, !!click),
    ].map((track) => {
      // A deck's lane and its stem lanes are filled from the SAME load, and placed by one computation.
      const stem = stemLaneOf(track.id, DECKS);
      const deck = (stem?.deck ?? track.id) as DeckId;
      const load = loads[deck];
      if (!load) return track;
      // An unseparated song leaves its stem lanes EMPTY, and plays off the deck's own lane instead.
      if (stem && !load.stems) return track;
      // …and a separated one is the other way round: the four PARTS play, so the record itself does not.
      if (!stem && load.stems) return { ...track, clips: [] };
      // Whatever plays, plays off a PLATTER: the whole record, or one of its four parts.
      return {
        ...track,
        clips: [],
        // FIRST on the chain: it is the source, and everything the project declared shapes what it makes.
        plugins: [
          platterPlugin(
            track.id,
            stem ? stemSource(load.path, stem.stem) : load.path,
            tempos[deck],
            !!playing[deck],
          ),
          ...track.plugins,
        ],
      };
    }),
  };
}

/** A document built from NOTHING, for the seconds before the compile lands — an imitation, docs/mix.md. */
export function deckDoc(
  loads: DeckLoads,
  mix: number = MIX_CENTRE,
  modules: Partial<Record<DeckId, DeckModule[]>> = {},
  tempos: DeckTempos = {},
  click: DeckId | null = null,
  playing: DeckPlaying = {},
): ProjectDoc {
  return emptyDoc({
    name: "m9",
    tempo: DOC_TEMPO,
    // Appended, like `withDecks` does it: the decks keep their places in the track list.
    tracks: [
      ...DECKS.map((deck) => {
        const load = loads[deck];
        return trackDoc(deck, {
          name: load ? load.title : deck,
          clips: [],
          // The platter FIRST when there is one — it is the source; then the effects, the level LAST.
          // The RECORD, even when it has been separated: this stand-in declares no stem lanes to
          // play the parts off, and playing the record itself is the closer imitation of the two.
          plugins: [
            ...(load
              ? [platterPlugin(deck, load.path, tempos[deck], !!playing[deck])]
              : []),
            ...(modules[deck] ?? []).map((m) => {
              const { type, name } = enginePlugin(m.plugin, m.name);
              return pluginDoc({
                id: `${deck}:${m.name}`,
                type,
                name,
                enabled: m.enabled,
              });
            }),
            pluginDoc({
              id: levelId(deck),
              type: MIXER_PLUGIN,
              name: `${deck} level`,
              params: { Volume: gainToDb(deckGain(deck, mix)) },
            }),
          ],
        });
      }),
      metronomeTrack(click ? tempos[click] : undefined, !!click),
    ],
  });
}

/** The track the click lives on. Always in the document — see `metronomeTrack`. */
export const METRONOME_TRACK = "metronome";

/** How loud the click sits under the music, in dB on its own strip. */
export const METRONOME_DB = -6;

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
    name: "métronome",
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
        name: "métronome level",
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

/** Move the crossfade without re-sending the document — `set-plugin-param`, one per pixel (docs/mix.md). */
export function pushCrossfade(engine: EngineClient, mix: number): void {
  for (const deck of DECKS)
    engine.setPluginParam(
      levelId(deck),
      "Volume",
      gainToDb(deckGain(deck, mix)),
    );
}

/** Send the decks as they stand — the COMPILED project when there is one, the stand-in when there is not. */
export function sendDecks(
  /** WHERE the document goes — `Deck.sendProject`, not an engine client: see docs/hosting.md. */
  send: (doc: ProjectDoc) => void,
  loads: DeckLoads,
  mix: number,
  modules?: Partial<Record<DeckId, DeckModule[]>>,
  tempos?: DeckTempos,
  compiled?: ProjectDoc | null,
  click: DeckId | null = null,
  /** Which platters should be turning — their `Rate`, which the one transport does not decide. */
  playing: DeckPlaying = {},
): void {
  send(
    compiled
      ? withDecks(compiled, loads, tempos, click, playing)
      : deckDoc(loads, mix, modules, tempos, click, playing),
  );
}

/** The faders after one has been moved — the target, and nothing else, docs/bpm.md. */
export function nudgedTempos(
  faders: DeckTempos,
  deck: DeckId,
  bpm: number,
): DeckTempos {
  const stored = faders[deck];
  // A platter takes the new rate where it stands, so the music does not move and nothing follows it.
  return stored ? { ...faders, [deck]: { ...stored, target: bpm } } : faders;
}

/** The keylock switch belongs to the DECK, not to the record on it, so it is merged in rather than stored per song. */
export function withKeylock(
  tempos: DeckTempos,
  on: Partial<Record<DeckId, boolean>>,
): DeckTempos {
  const out: DeckTempos = { ...tempos };
  for (const deck of DECKS) {
    const t = out[deck];
    if (t) out[deck] = { ...t, keylock: !!on[deck] };
  }
  return out;
}

/** What the decks PLAY at: the slave takes the master's tempo. Its BEATS are put together by `alignSeek`. */
export function syncedTempos(
  tempos: DeckTempos,
  master: DeckId | null,
): DeckTempos {
  const lead = master && tempos[master];
  if (!master || !lead || !(lead.target > 0)) return tempos;
  const out: DeckTempos = { ...tempos };
  for (const deck of DECKS) {
    const t = out[deck];
    // A deck with no natural tempo cannot be pulled onto one — there is no ratio to drive its platter with.
    if (!t || deck === master || !(t.natural > 0)) continue;
    out[deck] = { ...t, target: lead.target };
  }
  return out;
}
