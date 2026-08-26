// useDeckLoops.ts — the desk's loop section: what is looping on each deck, and the two params that
// say so. Its own hook rather than more of useDeckSet, which is long enough.
//
// The one thing a reader would get wrong: a loop is turned off by moving the END alone. Dropping
// the start first would open a loop from zero for a block, and the record would leave. See
// ../docs/loop.md.

import { useCallback, useRef, useState } from "react";
import type { DeckId, DeckTempo } from "./deck";
import {
  beatSeconds,
  beatsBetween,
  DEFAULT_LOOP_BEATS,
  type DeckLoop,
  canLoop as gridEnough,
  beatJump as jumpTo,
  type LoopEdges,
  loopEdges,
  loopParams,
  resized,
  snapToBeat,
} from "./loop";

/** What the loop section offers a view. Every deck answers, loaded or not. */
export interface DeckLoops {
  /** This deck's loop, or null. `roll` on it is what the ✕ button refuses to close. */
  loopOf: (deck: DeckId) => DeckLoop | null;
  /** A manual IN with no OUT yet, in source seconds — what lights the IN button. */
  pendingOf: (deck: DeckId) => number | null;
  /** Can this deck loop? It takes a MEASURED tempo: no grid, no beats, no buttons. */
  canLoop: (deck: DeckId) => boolean;
  /** Toggle a loop of `beats` from where the needle is. The same length again closes it. */
  setLoop: (deck: DeckId, beats: number) => void;
  /** Mark where a manual loop starts; `loopOut` closes it. A second IN re-marks. */
  loopIn: (deck: DeckId) => void;
  loopOut: (deck: DeckId) => void;
  loopOff: (deck: DeckId) => void;
  /** Halve or double the running loop, keeping its start. */
  resizeLoop: (deck: DeckId, factor: number) => void;
  /** Hold a loop that hands the record back on release — the platter keeps the shadow, ../docs/loop.md. */
  roll: (deck: DeckId, beats: number, on: boolean) => void;
  /** Move by `beats`, signed. Takes the loop with it, and refuses while a roll is held. */
  beatJump: (deck: DeckId, beats: number) => void;
  /** The last length anybody asked for on this deck — what a beat jump moves by. */
  stepOf: (deck: DeckId) => number;
  /** Do loop edges and jumps land on the grid? One switch for the whole desk. */
  quantise: boolean;
  toggleQuantise: () => void;
}

/** What this hook needs from the deck set. Read through a ref, so none of it need be stable. */
export interface LoopDeps {
  /** Every platter of a deck — four when the record is separated, and they share one groove. */
  platters: (deck: DeckId) => string[];
  setParam: ((plugin: string, name: string, value: number) => void) | null;
  tempoOf: (deck: DeckId) => DeckTempo | undefined;
  needle: (deck: DeckId) => number;
  place: (deck: DeckId, source: number) => void;
}

type Loops = Partial<Record<DeckId, DeckLoop>>;

export function useDeckLoops(deps: LoopDeps): DeckLoops {
  const at = useRef(deps);
  at.current = deps;
  const [loops, setLoops] = useState<Loops>({});
  const held = useRef<Loops>({});
  held.current = loops;
  /** A manual IN waiting for its OUT — not state, since nothing is drawn from it but a lit button. */
  const [pending, setPending] = useState<Partial<Record<DeckId, number>>>({});
  const [steps, setSteps] = useState<Partial<Record<DeckId, number>>>({});
  const [quantise, setQuantise] = useState(true);

  /** Send what `loopParams` decided — to ALL of them, four platters sharing one groove. */
  const send = useCallback(
    (
      deckId: DeckId,
      edges: LoopEdges | null,
      roll: boolean,
      resize = false,
    ) => {
      const { platters, setParam } = at.current;
      if (!setParam) return;
      for (const id of platters(deckId))
        for (const [name, value] of loopParams(edges, roll, resize))
          setParam(id, name, value);
    },
    [],
  );

  const close = useCallback(
    (deckId: DeckId) => {
      send(deckId, null, false);
      setLoops((l) => ({ ...l, [deckId]: undefined }));
      setPending((p) => ({ ...p, [deckId]: undefined }));
    },
    [send],
  );

  /** Put one on, from a start already in source seconds. Refuses what would not be a loop. */
  const open = useCallback(
    (deckId: DeckId, start: number, beats: number, roll: boolean) => {
      const tempo = at.current.tempoOf(deckId);
      const loop: DeckLoop = { start, beats, roll };
      const edges = loopEdges(loop, tempo);
      if (!edges) return;
      send(deckId, edges, roll);
      setLoops((l) => ({ ...l, [deckId]: loop }));
      setPending((p) => ({ ...p, [deckId]: undefined }));
      setSteps((s) => ({ ...s, [deckId]: beats }));
    },
    [send],
  );

  /** Where a loop starts when the finger lands: the needle, on the grid when quantising is on. */
  const from = useCallback(
    (deckId: DeckId): number => {
      const now = at.current.needle(deckId);
      return quantise ? snapToBeat(now, at.current.tempoOf(deckId)) : now;
    },
    [quantise],
  );

  return {
    loopOf: (deckId) => loops[deckId] ?? null,
    pendingOf: (deckId) => pending[deckId] ?? null,
    canLoop: (deckId) => gridEnough(deps.tempoOf(deckId)),
    stepOf: (deckId) => steps[deckId] ?? DEFAULT_LOOP_BEATS,
    quantise,
    toggleQuantise: () => setQuantise((q) => !q),

    setLoop: (deckId, beats) => {
      const on = held.current[deckId];
      // The same length again is the way out — a lit button that does nothing would be a dead one.
      if (on && !on.roll && on.beats === beats) {
        close(deckId);
        return;
      }
      open(deckId, from(deckId), beats, false);
    },

    loopIn: (deckId) => {
      if (!gridEnough(at.current.tempoOf(deckId))) return;
      setPending((p) => ({ ...p, [deckId]: from(deckId) }));
    },

    loopOut: (deckId) => {
      const start = pending[deckId];
      if (start == null) return;
      const tempo = at.current.tempoOf(deckId);
      const end = from(deckId);
      // Backwards is not a loop: a hand that closed one before it opened it gets nothing.
      if (!(end > start)) {
        setPending((p) => ({ ...p, [deckId]: undefined }));
        return;
      }
      open(deckId, start, beatsBetween(start, end, tempo), false);
    },

    loopOff: (deckId) => close(deckId),

    resizeLoop: (deckId, factor) => {
      const on = held.current[deckId];
      if (!on) return;
      const beats = resized(on.beats, factor);
      const next: DeckLoop = { ...on, beats };
      const edges = loopEdges(next, at.current.tempoOf(deckId));
      if (!edges) return;
      send(deckId, edges, on.roll, true);
      setLoops((l) => ({ ...l, [deckId]: next }));
      setSteps((s) => ({ ...s, [deckId]: beats }));
    },

    roll: (deckId, beats, on) => {
      if (on) open(deckId, from(deckId), beats, true);
      // Letting go is the jump BACK, and the platter is the one that knows where to.
      else if (held.current[deckId]?.roll) close(deckId);
    },

    beatJump: (deckId, beats) => {
      const tempo = at.current.tempoOf(deckId);
      const on = held.current[deckId];
      // A roll already owes the record a position; moving it would be two answers to one question.
      if (on?.roll) return;
      const to = jumpTo(at.current.needle(deckId), beats, tempo, quantise);
      // The loop goes FIRST: a needle placed while the old edges still stand gets wrapped back in.
      if (on) {
        const moved: DeckLoop = {
          ...on,
          start: Math.max(0, on.start + beats * beatSeconds(tempo)),
        };
        const edges = loopEdges(moved, tempo);
        if (edges) {
          send(deckId, edges, false);
          setLoops((l) => ({ ...l, [deckId]: moved }));
        }
      }
      at.current.place(deckId, to);
    },
  };
}
