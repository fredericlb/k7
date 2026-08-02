// deck.ts — one song on the engine. The whole of platines v1: a file path becomes a
// one-track ProjectDoc, the transport plays it, and the étape-7 broadcast lets this browser
// hear what the interface is putting out. See docs/plumbing.md.

import type { EngineClient } from "@studio/engine-browser";
import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";

/** The chain a deck lives on. One name, so the document is predictable and the engine's
 *  diff sees a track it already has rather than a new one on every load. */
export const DECK = "deck-a";

/**
 * The smallest document that plays one file.
 *
 * `recordDir` stays empty (see emptyDoc): a deck plays and never records, and a made-up
 * directory is a path the engine would eventually try to write into.
 *
 * Deliberately NOT `MoteurPlayer` from @studio/player-web, which does exactly this in its
 * first ten lines. That class implements obscura's `Player` — preloadSong, playMulti,
 * playDual, playReversed, nine effect sliders — and nine tenths of it is a blind test's
 * vocabulary, not a deck's. Reusing it would mean platines inheriting semantics it has to
 * explain away. What IS shared is the layer under both: the document constructors in
 * @studio/engine-protocol/build, which is where the duplication was actually worth removing.
 */
export function deckDoc(absolutePath: string, name: string): ProjectDoc {
  return emptyDoc({
    name: `platines: ${name}`,
    tracks: [
      trackDoc(DECK, {
        name,
        clips: [
          clipDoc({
            id: `${DECK}-clip`,
            type: "audio",
            name,
            source: absolutePath,
          }),
        ],
      }),
    ],
  });
}

/** Load a song and start it. Two messages, in this order — a transport verb before the
 *  document would play whatever the engine had loaded before, which on a deck is the
 *  previous song. */
export function loadAndPlay(
  engine: EngineClient,
  absolutePath: string,
  name: string,
): void {
  engine.sendProject(deckDoc(absolutePath, name));
  engine.transport("play");
}
