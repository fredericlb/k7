// useLiveEnvelope.ts — the take being played, as an envelope that GROWS. The engine pushes input
// levels ~20×/s and nothing has written a file yet, so this is the only picture of a take while it
// is still being made; the file's own waveform replaces it the moment the recorder closes it.
// The samples live in a ring OUTSIDE React: the panel holding this hook never renders for them,
// and only the leaves that draw the take (`useLiveSamples`) do — docs/audit.md.

import {
  INPUT_VU_MAX_DB,
  INPUT_VU_MIN_DB,
  useEngineStore,
} from "@studio/engine-browser/store";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RingBuffer } from "../ringBuffer";

/** How long one engine frame stands for — the nominal, since a growing take is read for its SHAPE and not for its timings. */
export const LIVE_FRAME_MS = 50;

// Ten minutes at 20 Hz: a take that outruns it scrolls, where an unbounded envelope would redraw more slowly the longer you played.
const MAX_FRAMES = 12000;

// Every other frame reaches the drawing leaves: the engine's rate is the meters', and each update re-rasterises the whole contour.
const KEEP_EVERY = 2;

// One input dB reading mapped to 0..1, through the same range as the meters.
function level(db: number): number {
  const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The growing take, stable for the hook's life: read with `useLiveSamples`, never by the hook's own caller per frame. */
export interface LiveTake {
  intervalMs: number;
  /** How many frames are held — read at render, it is current whenever the caller renders for its own reasons. */
  length: () => number;
  subscribe: (cb: () => void) => () => void;
  /** The samples as of the last published update, the same array until the next one. */
  snapshot: () => number[];
}

const EMPTY: number[] = [];

/** ONE envelope, the loudest armed input per frame, cleared when a take STARTS — held in a ring, published to subscribers at 10 Hz. */
export function useLiveEnvelope(
  rolling: boolean,
  trackOrder: string[],
): LiveTake {
  const store = useEngineStore();
  // Read inside the subscription, which is bound once and must not be rebound on a transport change.
  const rollingRef = useRef(rolling);
  rollingRef.current = rolling;
  const orderRef = useRef(trackOrder);
  orderRef.current = trackOrder;

  const [take] = useState(() => {
    const ring = new RingBuffer(MAX_FRAMES);
    const listeners = new Set<() => void>();
    let snap: number[] = EMPTY;
    let n = 0;
    const publish = () => {
      snap = ring.length ? ring.toArray() : EMPTY;
      for (const l of listeners) l();
    };
    return {
      ring,
      publish,
      tick: () => ++n % KEEP_EVERY === 0,
      reset: () => {
        ring.clear();
        n = 0;
        publish();
      },
      live: {
        intervalMs: LIVE_FRAME_MS,
        length: () => ring.length,
        subscribe: (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        snapshot: () => snap,
      } satisfies LiveTake,
    };
  });

  // A new take starts from nothing. `rolling` going true is the only edge that clears.
  useEffect(() => {
    if (rolling) take.reset();
  }, [rolling, take]);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      if (!rollingRef.current) return; // the take is over — it is a picture now
      const s = store.getSnapshot();
      let peak = 0;
      for (const id of s.armed) {
        const i = orderRef.current.indexOf(id);
        if (i >= 0) peak = Math.max(peak, level(s.inputLevels[i] ?? -Infinity));
      }
      take.ring.push(peak);
      if (take.tick()) take.publish();
    });
    return unsub;
  }, [store, take]);

  return take.live;
}

/** The growing take's samples, re-rendering only the leaf that calls it, at the published rate. */
export function useLiveSamples(live: LiveTake): number[] {
  return useSyncExternalStore(live.subscribe, live.snapshot, live.snapshot);
}
