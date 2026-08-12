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
import { alignDelay, BEATS_PER_BAR } from "./beats";
import type { DeckModule } from "./graph";

/**
 * The two decks, named as the PROJECT names them (`chains.yaml`: `deckA`, `deckB`).
 *
 * Not a cosmetic match. The day playback goes through the compiler — which is what has to
 * happen for the project's own `crossfade` module to run (see docs/mix.md) — the track ids in
 * the document stop being built here and start coming from the project, and everything
 * addressed by them keeps working only if the two agree today.
 */
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
}

export type DeckLoads = Record<DeckId, DeckLoad | null>;
export const NO_LOADS: DeckLoads = { deckA: null, deckB: null };

/** The crossfader's middle — both decks at once, which is where a set starts. */
export const MIX_CENTRE = 0.5;

/**
 * The tempo the TIMELINE runs at. Fixed, and that is the whole trick.
 *
 * There is one document and therefore one tempo, but the two decks must be able to play at
 * two different BPMs. So the timeline stays put and each deck reaches its own target through
 * its OWN warp — the stretch is per clip, the tempo is not. Changing this constant changes
 * nothing audible; every warp below is computed against it.
 */
export const DOC_TEMPO = 120;

/** How far a deck's tempo bends either way, as a fraction of the song's own — ±16 %, a DJ
 *  deck's wide setting. Beyond it a stretch stops sounding like the record. */
export const PITCH_RANGE = 0.16;

/**
 * How far into the timeline a deck's clip is placed when nothing has moved it — the HEADROOM
 * a pitch fader needs, in seconds.
 *
 * Slowing a deck down means the same music must now take longer to reach where it already is,
 * which is only expressible by starting its clip EARLIER (see `slipAfter`). A timeline that
 * begins at zero has nowhere earlier to go, so a deck slowed even slightly would need a
 * negative start — which the engine does accept, but which then maps a cue near the top of the
 * song to a negative transport the engine clamps, silently sending that cue somewhere else.
 *
 * Ten minutes covers an hour-long track bent the full ±16 %, and costs nothing: the timeline
 * is m9's own and holds nothing but these two clips. The one thing it does cost is that the
 * transport no longer starts where the music does, which is why loading the first song seeks
 * here — and why every surface reads the FILE's clock through `sourceAt` rather than the
 * transport's.
 */
export const TIMELINE_BASE = 600;

/**
 * The module a deck's tempo BELONGS to, and the param the fader is.
 *
 * The project says this outright: `example.m9`'s chains put a node of the médiathèque's
 * cold `tempo` module on each deck, and the fader is that node's `Target BPM`. Written
 * here so the browser's stand-in below is anchored to the thing it stands in for rather than
 * being a second, unrelated way to change a tempo.
 *
 * Nothing sends these yet, for the reason the crossfade's module is not sent either: the
 * module is `plugin: {type: offline}` — a pass writes stretched audio to disk — so it has no
 * live parameter and no engine plugin. `warpFor` is how the browser realises it meanwhile.
 */
export const TEMPO_MODULE = "@mediatek/audio/utility/tempo";
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
  /**
   * Where this song's beat grid starts, in SOURCE seconds — `beats.ts`'s `phase`.
   *
   * A fact about the file, measured once when the envelope lands and never moved by a fader:
   * stretching changes how often a beat happens, not which moment is the first one.
   */
  phase?: number;
  /**
   * TIMELINE beats to delay this deck's clip by, so its beats meet the other deck's.
   *
   * Only the slave of a sync ever carries one; absent means "start at zero", which is every
   * deck the rest of the time. Derived by `syncedTempos`, never stored — see `alignDelay`.
   */
  align?: number;
  /**
   * How far this deck's clip has slid, in SECONDS, so that changing its tempo did not move
   * the music. Accumulated by `slipAfter`; see it for why this exists at all.
   *
   * Unlike `align` this is STORED, because it is a history: it is where the fader has already
   * carried this deck, and re-deriving it from the current tempo is impossible — the same
   * tempo reached by two different routes leaves the record in two different places, exactly
   * as it does on a real deck.
   */
  slip?: number;
}

export type DeckTempos = Partial<Record<DeckId, DeckTempo>>;

/**
 * The ends of the tempo fader — the MODULE's knob, not a range m9 invented.
 *
 * `@mediatek/audio/utility/tempo`'s `ui.yaml` declares a BPM knob from 10 to 300, and the
 * fader in Mix IS that knob. Keeping the two the same is the point: a surface that offered a
 * narrower range would be quietly refusing values the module accepts, and one that offered a
 * wider one would send values the panel cannot draw.
 *
 * Wide enough that a drag is coarse — 290 BPM across a screen — which is why the fader keeps
 * a notch at the song's own tempo, a 0.1 step, and a double-click back to it. The ±16 % of a
 * real deck survives as `PITCH_RANGE`, now purely the threshold past which the readout warns
 * that a stretch has stopped sounding like the record.
 */
export const BPM_RANGE: readonly [min: number, max: number] = [10, 300];

/**
 * The ends of an EQ knob, in dB — the module's own, for the same reason `BPM_RANGE` is.
 *
 * ±20 dB is what Tracktion's 4-band EQ accepts and what `eq3`'s panel draws, so the desk
 * offers exactly that: narrower would refuse values the module takes, wider would send ones
 * the panel cannot draw. Symmetric, so flat lands in the middle of the travel — a mixing desk
 * cuts further than it boosts by USE, not because the control forbids it.
 */
export const EQ_DB: readonly [min: number, max: number] = [-20, 20];

/**
 * The ends of a deck's filter knob — the module's own, signed so the neutral is the middle.
 *
 * The `sweep` module is ONE param by design: a desk control drives at most one, so "low-pass
 * or high-pass" cannot be a second setting. Left runs a low-pass down, right runs a high-pass
 * up, and 0 is inaudible rather than bypassed.
 */
export const FILTER_RANGE: readonly [min: number, max: number] = [-100, 100];

/** The three bands a deck's EQ strip draws, low to high — the order they sit in. */
export const EQ_BANDS = [
  { id: "eqLow", label: "GRAVE" },
  { id: "eqMid", label: "MÉDIUM" },
  { id: "eqHigh", label: "AIGU" },
] as const;

/**
 * The eight cue buttons a deck draws, and the colour each one wears once it holds something.
 *
 * A colour per BUTTON rather than per cue: the point of a hot cue is that your hand knows
 * where it is without reading, so slot 3 has to look like slot 3 on both decks and on every
 * song. White is the empty state — see `CueButtons`.
 *
 * Spread around the wheel and kept away from the amber the tempo readout warns in, so a cue
 * cannot be mistaken for a warning at a glance.
 */
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

/**
 * Where a moment in the FILE lands on the transport, in seconds.
 *
 * The conversion a cue point cannot do without. A marker is a position in the SOURCE — where
 * the drop is, a fact about the recording — while `seek` takes a position on the timeline, and
 * a warped deck maps one onto the other by the ratio it is being stretched by. Storing the
 * transport's number instead would move every cue the moment somebody touched the tempo fader,
 * silently and only on the decks that had been stretched.
 *
 * `align` is the sync's own delay, in document beats, and it shifts the whole clip — so it
 * shifts every cue with it, which is what keeps a cued deck cued after it has been beat-matched.
 */
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

/**
 * Where the clip starts on the timeline, in seconds — the base, sync's alignment, and the slip.
 *
 * Three terms because they are three different facts: the headroom every deck gets, where sync
 * put this one to meet the other's beats, and how far its own fader has carried it since.
 */
export function startSeconds(tempo: DeckTempo | undefined): number {
  return (
    TIMELINE_BASE + ((tempo?.align ?? 0) * 60) / DOC_TEMPO + (tempo?.slip ?? 0)
  );
}

/** Where a deck's clip sits, in the BEATS the document places clips in. */
export function clipStartBeats(tempo: DeckTempo | undefined): number {
  return (startSeconds(tempo) * DOC_TEMPO) / 60;
}

/**
 * The slip a deck must take on so that changing its tempo does not move the MUSIC.
 *
 * This is the whole of what a pitch fader is. On a real deck the platter changes speed and the
 * needle stays in its groove; the record does not jump. Here the deck is a clip on a timeline
 * and the transport is a position on that timeline, so re-stretching the clip changes which
 * source second sits under the playhead — and unless the clip moves with it, the music leaps.
 * Measured before this existed: one step of a +8 % drag ate **980 ms** of the track, and a
 * whole drag ate a full second, delivered as a lurch per step. See ../docs/bpm.md.
 *
 * The correction's SHAPE is why it holds up. Keeping source `s` under transport `T` means
 * `T = start + s·ratio` before and after, so `start` moves by `s·(before − after)` and `T`
 * never appears. What that buys is accuracy: the only estimate involved is where the deck is
 * in the file, and it enters MULTIPLIED by the ratio change — about a hundredth. A playhead
 * 50 ms stale therefore costs half a millisecond, where seeking the transport to a computed
 * position would have paid the whole 50 ms back as a stumble. Seeking would also have been
 * wrong twice over: there is one transport and two decks, so moving it to hold one deck still
 * would throw the other.
 *
 * `align` is subtracted for the same reason it is added to the start: dragging the MASTER of a
 * sync changes what the slave must be delayed by, and a delay that changes under a deck is a
 * deck that jumps. Absorbed here, that side effect becomes invisible — while pressing sync
 * itself is left alone, because putting the grids together is exactly a deliberate move.
 *
 * Never past the start of the timeline. `TIMELINE_BASE` is sized so that clamp is unreachable
 * in practice; it is here because a fader that runs to 10 BPM can ask for anything.
 */
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

/**
 * The stretch that makes a song of `natural` BPM play at `target`.
 *
 * **This is the browser's stand-in for `TEMPO_MODULE`.** The project declares the tempo as a
 * module on each deck; that module is cold and offline, so it cannot run live and cannot be
 * sent as a plugin. A clip warp is the one thing the engine WILL do live, so the fader lands
 * here — and when the cold pass exists, this is what it replaces. `natural`/`target` are the
 * module's `Source BPM`/`Target BPM` under different names for the same two facts.
 *
 * Two markers is a linear stretch (`WarpDoc`), each `[timeline beat, source second]`. The end
 * marker puts the whole file at the beat it should finish on:
 *
 *   real seconds to play it = seconds × natural / target
 *   beats in that time      = real seconds × DOC_TEMPO / 60
 *
 * which is why `natural` and `target` appear as a ratio and the file's length passes through
 * untouched. `elastique` preserves PITCH — a stretched record does not go up in key, unlike a
 * turntable's platter. That is the modern behaviour and worth knowing rather than assuming.
 *
 * Undefined for a song with no detected tempo, a zero length, or a target equal to natural:
 * an identity warp would put the stretch engine in the path for nothing, costing CPU and
 * quality to change absolutely nothing.
 */
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

/**
 * A deck's linear gain at crossfade position `mix` (0 = A alone, 1 = B alone).
 *
 * Equal GAIN, deliberately the same law as the project's crossfade module writes in its
 * `jsdsp.ts` (`a*(1-mix) + b*mix`). The two are not connected by code — one runs in the
 * engine's graph host, the other is a level on a track — so the only thing keeping them the
 * same is that both are written down as this line, and a test that says so.
 *
 * It dips ~3 dB at centre for uncorrelated material. That is the known shape of an equal-gain
 * fade, not a bug: equal-POWER needs a square root, and the module has no such primitive.
 */
export function deckGain(deck: DeckId, mix: number): number {
  const clamped = Math.min(1, Math.max(0, mix));
  return deck === "deckA" ? 1 - clamped : clamped;
}

/**
 * A linear gain as the decibels a strip's `Volume` actually takes.
 *
 * Silence is the FLOOR and not -Infinity: the parameter is a fader with a bottom, and sending
 * -Infinity would be a number the engine has to defend itself against for no gain in what you
 * can hear. Below the floor is silence as far as this vocabulary goes.
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) return VOLUME_DB.min;
  return Math.max(
    VOLUME_DB.min,
    Math.min(VOLUME_DB.max, 20 * Math.log10(gain)),
  );
}

/** The id of the level at the end of a deck's chain — the thing the crossfader moves. */
export const levelId = (deck: DeckId): string => `${deck}:level`;

/**
 * The document that plays both decks.
 *
 * Both tracks are ALWAYS present, loaded or not. The engine diffs what it is sent, so keeping
 * the track ids constant makes loading a song a clip change rather than a track appearing —
 * and an empty deck is a real state a set spends most of its time in.
 *
 * `recordDir` stays empty (see emptyDoc): a deck plays and never records, and a made-up
 * directory is a path the engine would eventually try to write into.
 */
/**
 * The COMPILED project with the decks' songs filled in — what the engine is actually sent.
 *
 * This replaces a document m9 used to build from nothing, and the difference is the whole
 * point: the chains, the crossfade's baked DSP graph and `sidechainFrom: deckB` all come from
 * the compiler now, so what plays is the project rather than an imitation of it. The one thing
 * the project cannot say is which song is on a deck — that is a live choice, and its tracks
 * are declared with `clips: []` precisely so this can fill them.
 *
 * Everything else is left ALONE. A plugin, a send, an automation the project declares is the
 * project's business; touching any of it here would put m9 back in the business of deciding
 * what a set sounds like.
 */
export function withDecks(
  compiled: ProjectDoc,
  loads: DeckLoads,
  tempos: DeckTempos = {},
  /** Which deck's beat the click follows, or null for no click — see `metronomeDeck`. */
  click: DeckId | null = null,
): ProjectDoc {
  return {
    ...compiled,
    // The click is APPENDED, not declared: it is a desk control, not part of the set. The
    // project's own tracks are still the project's business, and it is the one track here
    // whose id `chains.yaml` never mentions.
    tracks: [
      ...compiled.tracks,
      metronomeTrack(click ? tempos[click] : undefined, !!click),
    ].map((track) => {
      const load = loads[track.id as DeckId];
      if (!load) return track;
      const tempo = tempos[track.id as DeckId];
      const warp = tempo && warpFor(tempo);
      return {
        ...track,
        clips: [
          clipDoc({
            id: `${track.id}-clip`,
            type: "audio",
            name: load.title,
            source: load.path,
            // The headroom, sync's beat alignment and the fader's slip, in one number — see
            // `startSeconds`. Always present now: the base is never zero.
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

/**
 * A document built from NOTHING — two tracks, a level each, no project.
 *
 * Kept for the state m9 spends its first seconds in: the compile has not arrived (or the
 * project will not compile), and a deck still has to be able to play. It is an imitation of
 * the set and says so — no crossfade module, so the crossfader moves the two levels instead.
 * `withDecks` is the real thing.
 */
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
    // Appended, like `withDecks` does it: the decks keep their places, so nothing that counts
    // tracks has to learn about a control that is not one of them.
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
                  // Both or neither: the markers say how the source maps onto the timeline and
                  // `length` says how much timeline it takes. Warping without the length would
                  // leave the clip claiming its unstretched span.
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
          // The deck's own effects first, then the level LAST — a strip is the end of a chain,
          // so a module added to a deck is heard before the crossfader touches it.
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

/**
 * WHICH deck's beat the metronome would follow, or null when it cannot be offered.
 *
 * The rule the desk shows and this decides: a click needs ONE beat to be about. With a single
 * deck loaded that is that deck; with two, only a sync makes one of them speak for both, and
 * the master is the one that does. Two decks running free have two beats and no single click
 * can be on both — which is why the button goes dark rather than picking a side.
 *
 * It also needs the beat to have been MEASURED. A tempo without a phase says how often a beat
 * happens and not which moment is one, and a click on the wrong half of the beat is not a
 * degraded metronome — it is a wrong one you would beat-match against. `beats.ts` already
 * refuses to publish a phase it cannot defend; this refuses to guess past that.
 */
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

/**
 * The click, as a track the engine plays — NOT the engine's own metronome.
 *
 * `settings.metronome` clicks on the DOCUMENT's grid: beats of `DOC_TEMPO`, counted from
 * transport zero. m9's document tempo is fixed on purpose (two decks, two BPMs) and a deck's
 * music sits ten minutes in at a tempo of its own, with its first beat wherever the recording
 * put it. Those two grids have no reason to meet, so that click would flam against the music —
 * worse than none, because you would beat-match to it.
 *
 * Setting the document's tempo to the deck's would fix the SPACING and not the phase, and the
 * phase cannot be fixed that way either: holding the music still through a tempo change moves
 * the song's downbeat by `(where you are − where the beat is) × the change in stretch`, which
 * at two minutes in is some twenty beats' worth. The alignment would survive one drag step.
 *
 * So the notes are placed here instead, in document beats used purely as a unit of TIME: one
 * bar at the deck's own tempo, starting on the song's own downbeat, looped to the end of the
 * song. The document's tempo is never touched and the decks are never moved.
 *
 * The track is in the document whether the click is on or not, and silence is an empty clip
 * list. Not tidiness: `ChangeKind::TrackRemoved` is a stub in the engine, so a track taken out
 * of the document stays in the edit — and a metronome that cannot be switched off is a worse
 * bug than the feature is a feature. Clip removal, which this leans on instead, is real.
 *
 * See ../docs/metronome.md.
 */
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
        // A click is an envelope, not a waveform: instant on, gone in thirty milliseconds,
        // nothing sustained. The pitch is the note's, so the downbeat is simply higher.
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
  // Document beats are a unit of TIME here and nothing more: one beat of the DECK is however
  // many of them it takes to last 60/target seconds.
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
    // Four notes and a loop rather than one per beat for the whole song: the clip is rebuilt on
    // every step of a tempo drag, and a six-minute track is a thousand notes to re-send.
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

/**
 * Move the crossfade without re-sending the document.
 *
 * A slider emits a value per pixel dragged, and re-sending a whole project for each one would
 * have the engine diff a document that differs by two numbers. `set-plugin-param` is the
 * message this exists for, and it is what l8's knobs already use.
 *
 * When playback moves to the compiled project, this is the ONE function that changes: the
 * same gesture sets `Mix` on `deckA:crossfade` — the project's module — instead of a level on
 * each deck. Everything above it stays as it is.
 */
export function pushCrossfade(engine: EngineClient, mix: number): void {
  for (const deck of DECKS)
    engine.setPluginParam(
      levelId(deck),
      "Volume",
      gainToDb(deckGain(deck, mix)),
    );
}

/**
 * Send the decks as they now stand.
 *
 * The COMPILED project when there is one, the stand-in when there is not. The engine diffs, so
 * a song already playing on the other deck keeps playing under it — and the switch from one
 * document to the other is itself a diff, not a reload.
 */
export function sendDecks(
  /**
   * WHERE the document goes — `Deck.sendProject`, not an engine client.
   *
   * The two hosts disagree about who may write to an engine: m9's browser is the only writer
   * and sends straight out of its socket, while l8's file service is the only writer and takes
   * the document over a route. Taking a client here would have hardcoded m9's answer, which is
   * exactly the bug this parameter replaced — two writers for one engine, last one wins.
   */
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

/**
 * What the two decks should PLAY at, given where the faders are and who is master.
 *
 * Sync is TWO facts, and the tempo is only the first. Two decks at 128 BPM whose downbeats sit
 * 200 ms apart are not synced, they are flamming — so this also hands the slave the delay that
 * puts its beats on the master's, which is what `align` carries. See `alignDelay`.
 *
 * The tempo half: the master keeps its own fader and the slave is handed the master's number.
 * Not clamped to the slave's own ±16 % — "synced" means the same tempo, and a clamp would
 * silently leave the two decks at different BPMs while the button claimed otherwise.
 * `faderRange` widens the slave's scale instead, so the fader can honestly draw where it has
 * been put.
 *
 * A master with no tempo of its own (`natural: 0`, the engine found none) drives nothing:
 * there is no number to sync to, and inventing one is the confident lie this avoids. A deck
 * whose ONSETS say nothing (no transients, so no grid) still gets the tempo and no delay —
 * matching the speed is worth having on its own, and a phase invented from nothing would move
 * the record for no reason.
 *
 * Nothing here CANCELS sync — that is the view's business, because it happens on a gesture
 * (a hand on the slave's knob) rather than on a value. See `nudge` in MixView.
 */
/**
 * The faders after one has been moved — targets AND the slip each deck takes on for it.
 *
 * The gesture, as opposed to the derivation: `syncedTempos` is recomputed from scratch on every
 * render and must therefore stay free of history, while a slip is history and can only be
 * accumulated where the hand actually moved something. Both live here so that the pair stays
 * consistent — what a deck ends up stretched by, and what it slid to keep its music still.
 */
export function nudgedTempos(
  faders: DeckTempos,
  master: DeckId | null,
  /**
   * Who leads AFTER this gesture — `null` when a hand on the slave's fader has just cancelled
   * the sync. Separate from `master` on purpose: what a deck was PLAYING at a moment ago is
   * read with the sync still on, and reading it with the sync already off would compute the
   * slip against a tempo the deck never had.
   */
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
  // BOTH decks, not just the one under the hand: a synced slave is handed the master's number,
  // so a drag on the master re-stretches the slave too, and a re-stretch that nothing corrects
  // is a deck that jumps. A deck whose stretch and delay both came out unchanged is left
  // strictly alone, so an unloaded or unsynced deck never grows a slip out of nothing.
  for (const d of DECKS) {
    const b = before[d];
    const a = after[d];
    if (!b || !a || (b.target === a.target && b.align === a.align)) continue;
    // Only the SLIP is written back. `target` on a slave is the master's, handed over by the
    // derivation each render; storing it would leave the slave holding a number that was never
    // its own the moment sync is let go.
    const stored = out[d];
    if (stored) out[d] = { ...stored, slip: slipAfter(b, a, sourceOf(d)) };
  }
  return out;
}

export function syncedTempos(
  tempos: DeckTempos,
  master: DeckId | null,
): DeckTempos {
  const lead = master && tempos[master];
  if (!master || !lead || !(lead.target > 0)) return tempos;
  const out: DeckTempos = { ...tempos };
  for (const deck of DECKS) {
    const t = out[deck];
    // A deck with no natural tempo cannot be stretched to one either — `warpFor` would
    // refuse anyway, and this keeps the fader showing the truth about that.
    if (!t || deck === master || !(t.natural > 0)) continue;
    const synced = { ...t, target: lead.target };
    out[deck] = { ...synced, align: alignDelay(lead, synced, DOC_TEMPO) };
  }
  return out;
}
