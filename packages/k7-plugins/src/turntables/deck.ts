// deck.ts — the two decks as ONE document the engine plays: a track each, a level each, and
// the crossfade between them. The engine has one transport, so both decks run off it and the
// crossfader decides what is heard. See docs/mix.md.
//
// What a deck IS, and the ends of every knob, are in `deckVocabulary.ts`; the click track this
// document carries is in `metronome.ts`. Both are read from here and neither reads back.

import type { EngineClient } from "@studio/engine-browser";
import {
  emptyDoc,
  enginePlugin,
  MIXER_PLUGIN,
  pluginDoc,
  trackDoc,
  VOLUME_DB,
} from "@studio/engine-protocol/build";
import type { PluginDoc, ProjectDoc } from "@studio/engine-protocol/project";
import {
  deckPlatter,
  STEMS,
  STEMS_DIR,
  type Stem,
  stemFile,
  stemLane,
  stemLaneOf,
  stemPlatter,
} from "@studio/song-schema/stems";
import {
  DECKS,
  type DeckId,
  type DeckLoad,
  type DeckLoads,
  type DeckModule,
  type DeckTempo,
  type DeckTempos,
  DOC_TEMPO,
  MIX_CENTRE,
  ratioOf,
} from "./deckVocabulary";
import { metronomeTrack } from "./metronome";
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

/** The engine's platter type. Kept for the STAND-IN only — a real set DECLARES its platters now. */
export const PLATTER_TYPE = "studio_turntable";

/** A plugin's engine address: the chain it heads, then the module — `deckA:platterA`. */
const pluginId = (track: string, module: string): string =>
  `${track}:${module}`;

/** Every platter a deck drives, in the order the parts are named. Empty when it holds nothing.
 *
 * A separated record is FOUR platters and not one: the four parts ARE the record, so they share one
 * position, one rate and one KEY, and a gesture reaches all of them. See docs/stems.md.
 *
 * WHICH of the two it is depends on the record, not on the project — a set declares all five, and
 * `load.stems` says which are playing. That is why this is derived here and not bound in
 * `surfaces/desk.yaml`: it is true of what is on the deck right now (docs/platter-node-plan.md). */
export function plattersOf(deck: DeckId, load?: DeckLoad | null): string[] {
  if (!load) return [];
  return load.stems
    ? STEMS.map((s) => pluginId(stemLane(deck, s), stemPlatter(deck, s)))
    : [pluginId(deck, deckPlatter(deck))];
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
 * that is the sound of the gesture. See ../../../../packages/k7-plugins/docs/turntables/scratch.md. */
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

/** Put a record on a DECLARED platter: the file, and the two numbers a re-send must not lose.
 *
 * Three things and no more. The plugin, its id, its type and its place in the chain all come from
 * the project now — this used to build the whole thing, which is why a set's source was invisible
 * on the graph. See docs/platter-node-plan.md.
 *
 * `Rate` and `Key` are here rather than left to the node's file because they are LIVE state: a deck
 * that is turning has to still be turning after the next document, and the file says `Rate: 0`.
 *
 * `Seek` is REMOVED, and that removal is the whole of this function's care. The engine reads a
 * CHANGED seek as a needle-drop and resets its stretcher with it; the node file declares `Seek: 0`,
 * so carrying the declared params through would re-assert 0 on every document. A tempo drag sends
 * one every 120 ms (`LIVE_WARP_MS`), which is eight needle-jumps a second — heard as crackle.
 * A jump is a LIVE message, and re-sending a document must not re-drop the needle. */
function onPlatter(
  plugin: PluginDoc,
  source: string,
  tempo: DeckTempo | undefined,
  playing: boolean,
): PluginDoc {
  // Dropped rather than overwritten: a param the document omits is one the engine does not touch.
  const { Seek: _live, ...held } = plugin.params;
  return {
    ...plugin,
    deckFile: source,
    params: {
      ...held,
      Rate: platterRate(tempo, playing),
      // KEY is a param of the platter, not a second way of playing — ../../../../engine/k7-runtime/docs/turntable.md.
      // No hand here: a document is what the deck does when nobody is touching it.
      Key: platterKey(tempo, false),
    },
  };
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
      // Whatever plays, plays off a PLATTER — one the PROJECT declares. All this writes is the
      // record and the two live numbers; the plugin, its type and its place are the compiler's.
      return {
        ...track,
        clips: [],
        plugins: track.plugins.map((p) =>
          p.type === PLATTER_TYPE
            ? onPlatter(
                p,
                stem ? stemSource(load.path, stem.stem) : load.path,
                tempos[deck],
                !!playing[deck],
              )
            : p,
        ),
      };
    }),
  };
}

/** The stand-in's platter, BUILT rather than patched — it declares no nodes, so there is none to
 *  patch. The last place in this file that invents a plugin, and it is why `PLATTER_TYPE` survives. */
function standInPlatter(
  track: string,
  source: string,
  tempo: DeckTempo | undefined,
  playing: boolean,
): PluginDoc {
  return pluginDoc({
    id: `${track}:platter`,
    type: PLATTER_TYPE,
    name: "platter",
    role: "instrument",
    deckFile: source,
    params: {
      Rate: platterRate(tempo, playing),
      Gain: 1,
      Key: platterKey(tempo, false),
    },
  });
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
              ? [standInPlatter(deck, load.path, tempos[deck], !!playing[deck])]
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
