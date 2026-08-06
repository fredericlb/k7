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
): ProjectDoc {
  return emptyDoc({
    name: "m9",
    tracks: DECKS.map((deck) => {
      const load = loads[deck];
      return trackDoc(deck, {
        name: load ? load.title : deck,
        clips: load
          ? [
              clipDoc({
                id: `${deck}-clip`,
                type: "audio",
                name: load.title,
                source: load.path,
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
): void {
  engine.sendProject(deckDoc(loads, mix, modules));
}
