// useDrawnNeedles.ts — one steered needle clock per deck (./needleClock.ts), read on demand by
// whatever draws at 60 fps. Its readers are STABLE: a view's animation loop keys its effect on them.
// See ../../docs/turntables/needleClock.md.

import { useMemo, useRef } from "react";
import { DECKS, type DeckId } from "./deckVocabulary";
import {
  type NeedleClock,
  newNeedleClock,
  readNeedle,
  type Span,
} from "./needleClock";

/** What a read needs to know about a deck, each read through a function so nothing here is a dependency. */
export interface NeedleSources {
  /** The platter's last reported needle — the raw 20 Hz number. */
  raw: (deck: DeckId) => number;
  /** The rate the deck was TOLD to run at; 0 when stopped or when the rate is the hand's. */
  rate: (deck: DeckId) => number;
  loop: (deck: DeckId) => Span | null;
}

/** A drawn needle per deck, each a stable `() => number`. */
export function useDrawnNeedles(
  sources: NeedleSources,
): Record<DeckId, () => number> {
  const src = useRef(sources);
  src.current = sources;
  const clocks = useRef<Partial<Record<DeckId, NeedleClock>>>({});
  return useMemo(
    () =>
      Object.fromEntries(
        DECKS.map((d) => [
          d,
          () => {
            const now = performance.now();
            const s = src.current;
            const raw = s.raw(d);
            const was = clocks.current[d] ?? newNeedleClock(raw, now);
            const input = { raw, rate: s.rate(d), loop: s.loop(d) };
            const { state, at } = readNeedle(was, input, now);
            clocks.current[d] = state;
            return at;
          },
        ]),
      ) as Record<DeckId, () => number>,
    [],
  );
}
