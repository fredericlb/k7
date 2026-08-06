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
import type { ProjectDoc } from "@studio/engine-protocol/project";
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
 * The module a deck's tempo BELONGS to, and the param the fader is.
 *
 * The project says this outright: `example.m9`'s chains put an instance of the médiathèque's
 * cold `tempo` module on each deck, and the fader is that instance's `Target BPM`. Written
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
}

export type DeckTempos = Partial<Record<DeckId, DeckTempo>>;

/**
 * The ends of a deck's BPM fader.
 *
 * ±`PITCH_RANGE` around the song's own tempo — **widened to include `current`**, because a
 * synced deck is driven to whatever the master is at, which can sit outside its own range.
 * A fader whose scale did not cover the value it is showing would draw the handle pinned at
 * an end while the number said something else, which is worse than a wide scale.
 */
export function faderRange(
  natural: number,
  current = natural,
): [min: number, max: number] {
  if (!(natural > 0)) return [0, 0];
  const lo = Math.min(natural * (1 - PITCH_RANGE), current);
  const hi = Math.max(natural * (1 + PITCH_RANGE), current);
  return [lo, hi];
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
export function deckDoc(
  loads: DeckLoads,
  mix: number = MIX_CENTRE,
  modules: Partial<Record<DeckId, DeckModule[]>> = {},
  tempos: DeckTempos = {},
): ProjectDoc {
  return emptyDoc({
    name: "m9",
    tempo: DOC_TEMPO,
    tracks: DECKS.map((deck) => {
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

/** Send the decks as they now stand. The engine diffs, so a song that was already playing on
 *  the other deck keeps playing under it. */
export function sendDecks(
  engine: EngineClient,
  loads: DeckLoads,
  mix: number,
  modules?: Partial<Record<DeckId, DeckModule[]>>,
  tempos?: DeckTempos,
): void {
  engine.sendProject(deckDoc(loads, mix, modules, tempos));
}

/**
 * What the two decks should PLAY at, given where the faders are and who is master.
 *
 * Sync is one deck driving the other, so the answer is: the master keeps its own fader, and
 * the slave is handed the master's number. Not clamped to the slave's own ±16 % — "synced"
 * means the same tempo, and a clamp would silently leave the two decks at different BPMs
 * while the button claimed otherwise. `faderRange` widens the slave's scale instead, so the
 * fader can honestly draw where it has been put.
 *
 * A master with no tempo of its own (`natural: 0`, the engine found none) drives nothing:
 * there is no number to sync to, and inventing one is the confident lie this avoids.
 */
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
    out[deck] = { ...t, target: lead.target };
  }
  return out;
}
