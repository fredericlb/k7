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
  STEMS_DIR,
  type Stem,
  stemFile,
  stemLaneOf,
} from "@studio/song-schema/stems";
import { alignDelay, BEATS_PER_BAR } from "./beats";
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

/** Where a deck's clip sits when nothing has moved it — the headroom a pitch fader needs, docs/bpm.md. */
export const TIMELINE_BASE = 600;

/** Where PLAY should start, or null to roll from here — below the music, start at the music (docs/bpm.md). */
export function playFrom(playheadSeconds: number): number | null {
  return playheadSeconds < TIMELINE_BASE ? TIMELINE_BASE : null;
}

/** The module a deck's tempo BELONGS to, and the params the faders are — `offline`, so `warpFor` realises it. */
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
  /** TIMELINE beats to delay this clip by so its beats meet the other's — derived, never stored. */
  align?: number;
  /** How far this clip has slid so a tempo change did not move the music — STORED, it is a history. */
  slip?: number;
}

export type DeckTempos = Partial<Record<DeckId, DeckTempo>>;

/** The ends of the tempo fader — the MODULE's own knob (`ui.yaml`), not a range m9 invented. See docs/bpm.md. */
export const BPM_RANGE: readonly [min: number, max: number] = [10, 300];

/** The ends of an EQ knob, in dB — the module's own, for the same reason `BPM_RANGE` is. See docs/eq.md. */
export const EQ_DB: readonly [min: number, max: number] = [-20, 20];

/** The ends of a deck's filter knob — one signed param, so the neutral is the middle. See docs/filter.md. */
export const FILTER_RANGE: readonly [min: number, max: number] = [-100, 100];

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

/** Where a moment in the FILE lands on the transport, in seconds — the conversion a cue needs, docs/cues.md. */
export function transportAt(
  source: number,
  tempo: DeckTempo | undefined,
): number {
  const ratio = playRatio(tempo);
  return startSeconds(tempo) + source * ratio;
}

/** …and back, for the cue somebody drops while the deck is playing. */
export function sourceAt(
  transport: number,
  tempo: DeckTempo | undefined,
): number {
  const ratio = playRatio(tempo);
  return Math.max(0, (transport - startSeconds(tempo)) / ratio);
}

/** How fast the file is playing, as a multiplier of its own clock. 1 when nothing says. */
function playRatio(tempo: DeckTempo | undefined): number {
  return ratioOf(tempo?.natural ?? 0, tempo?.target ?? 0);
}

/** Where the clip starts on the timeline, in seconds — the headroom, sync's alignment, and the slip. */
export function startSeconds(tempo: DeckTempo | undefined): number {
  return (
    TIMELINE_BASE + ((tempo?.align ?? 0) * 60) / DOC_TEMPO + (tempo?.slip ?? 0)
  );
}

/** Where a deck's clip sits, in the BEATS the document places clips in. */
export function clipStartBeats(tempo: DeckTempo | undefined): number {
  return (startSeconds(tempo) * DOC_TEMPO) / 60;
}

/** The slip a deck takes on so that changing its tempo does not move the MUSIC — see docs/bpm.md. */
export function slipAfter(
  before: DeckTempo,
  after: DeckTempo,
  sourceSeconds: number,
): number {
  const alignOf = (t: DeckTempo) => ((t.align ?? 0) * 60) / DOC_TEMPO;
  const moved =
    sourceSeconds *
      (ratioOf(before.natural, before.target) -
        ratioOf(after.natural, after.target)) -
    (alignOf(after) - alignOf(before));
  return Math.max((before.slip ?? 0) + moved, -TIMELINE_BASE - alignOf(after));
}

/** The stretch, as a multiplier of the file's own clock. 1 when either end is unknown. */
function ratioOf(natural: number, target: number): number {
  return natural > 0 && target > 0 ? natural / target : 1;
}

/** The stretch that makes a song of `natural` BPM play at `target` — the stand-in for `TEMPO_MODULE`, docs/bpm.md. */
export function warpFor(
  { natural, seconds, target }: DeckTempo,
  epsilon = 1e-6,
):
  | { algorithm: string; markers: [number, number][]; beats: number }
  | undefined {
  if (!(natural > 0) || !(target > 0) || !(seconds > 0)) return undefined;
  if (Math.abs(target - natural) < epsilon) return undefined;
  const beats = (seconds * DOC_TEMPO * natural) / (60 * target);
  return {
    algorithm: "elastique",
    markers: [
      [0, 0],
      [beats, seconds],
    ],
    beats,
  };
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

/** One stem's file beside its record — string work, not a path join: the path is the ENGINE machine's. */
export function stemSource(master: string, stem: Stem): string {
  const cut = Math.max(master.lastIndexOf("/"), master.lastIndexOf("\\"));
  const folder = cut < 0 ? "" : master.slice(0, cut + 1);
  return `${folder}${STEMS_DIR}/${stemFile(stem)}`;
}

/** The COMPILED project with the decks' songs filled in — everything else is left ALONE, docs/mix.md. */
export function withDecks(
  compiled: ProjectDoc,
  loads: DeckLoads,
  tempos: DeckTempos = {},
  /** Which deck's beat the click follows, or null for no click — see `metronomeDeck`. */
  click: DeckId | null = null,
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
      // An unseparated song leaves its stem lanes EMPTY, and an empty lane subtracts nothing.
      if (stem && !load.stems) return track;
      const tempo = tempos[deck];
      const warp = tempo && warpFor(tempo);
      return {
        ...track,
        clips: [
          clipDoc({
            id: `${track.id}-clip`,
            type: "audio",
            name: load.title,
            source: stem ? stemSource(load.path, stem.stem) : load.path,
            // The headroom, sync's alignment and the fader's slip in one number — see `startSeconds`.
            start: clipStartBeats(tempo),
            ...(warp
              ? {
                  warp: { algorithm: warp.algorithm, markers: warp.markers },
                  length: warp.beats,
                }
              : {}),
          }),
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
): ProjectDoc {
  return emptyDoc({
    name: "m9",
    tempo: DOC_TEMPO,
    // Appended, like `withDecks` does it: the decks keep their places in the track list.
    tracks: [
      ...DECKS.map((deck) => {
        const load = loads[deck];
        const warp = tempos[deck] && warpFor(tempos[deck]);
        return trackDoc(deck, {
          name: load ? load.title : deck,
          clips: load
            ? [
                clipDoc({
                  id: `${deck}-clip`,
                  type: "audio",
                  name: load.title,
                  source: load.path,
                  start: clipStartBeats(tempos[deck]),
                  // Both or neither: warping without the length leaves the clip claiming its unstretched span.
                  ...(warp
                    ? {
                        warp: {
                          algorithm: warp.algorithm,
                          markers: warp.markers,
                        },
                        length: warp.beats,
                      }
                    : {}),
                }),
              ]
            : [],
          // The deck's own effects first, then the level LAST — a strip is the end of a chain.
          plugins: [
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

/** One looping bar of clicks, placed on the song's own downbeat. */
function clickBar(tempo: DeckTempo): ClipDoc {
  const toBeats = (seconds: number) => (seconds * DOC_TEMPO) / 60;
  // Document beats are a unit of TIME here: one beat of the DECK lasts 60/target seconds.
  const beat = DOC_TEMPO / tempo.target;
  const from = transportAt(tempo.phase ?? 0, tempo);
  // To the end of the song and no further, so the click stops when the record does.
  const span = Math.max(
    beat,
    toBeats(transportAt(tempo.seconds, tempo) - from),
  );
  return clipDoc({
    id: `${METRONOME_TRACK}-clip`,
    type: "midi",
    name: "click",
    start: toBeats(from),
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
): void {
  send(
    compiled
      ? withDecks(compiled, loads, tempos, click)
      : deckDoc(loads, mix, modules, tempos, click),
  );
}

/** The faders after one has been moved — targets AND the slip each deck takes on for it, docs/bpm.md. */
export function nudgedTempos(
  faders: DeckTempos,
  master: DeckId | null,
  /** Who leads AFTER this gesture — separate from `master`, so the slip is computed against a real tempo. */
  nextMaster: DeckId | null,
  deck: DeckId,
  bpm: number,
  sourceOf: (deck: DeckId) => number,
): DeckTempos {
  if (!faders[deck]) return faders;
  const before = syncedTempos(faders, master);
  const moved: DeckTempos = {
    ...faders,
    [deck]: { ...faders[deck], target: bpm },
  };
  const after = syncedTempos(moved, nextMaster);
  const out: DeckTempos = { ...moved };
  // BOTH decks, not just the one under the hand: a drag on the master re-stretches the slave too.
  for (const d of DECKS) {
    const b = before[d];
    const a = after[d];
    if (!b || !a || (b.target === a.target && b.align === a.align)) continue;
    // Only the SLIP is written back: a slave's `target` is the master's, handed over each render.
    const stored = out[d];
    if (stored) out[d] = { ...stored, slip: slipAfter(b, a, sourceOf(d)) };
  }
  return out;
}

/** What the decks PLAY at: the slave takes the master's tempo AND a delay onto its beats — docs/bpm.md. */
export function syncedTempos(
  tempos: DeckTempos,
  master: DeckId | null,
): DeckTempos {
  const lead = master && tempos[master];
  if (!master || !lead || !(lead.target > 0)) return tempos;
  const out: DeckTempos = { ...tempos };
  for (const deck of DECKS) {
    const t = out[deck];
    // A deck with no natural tempo cannot be stretched to one — `warpFor` would refuse anyway.
    if (!t || deck === master || !(t.natural > 0)) continue;
    const synced = { ...t, target: lead.target };
    out[deck] = { ...synced, align: alignDelay(lead, synced, DOC_TEMPO) };
  }
  return out;
}
