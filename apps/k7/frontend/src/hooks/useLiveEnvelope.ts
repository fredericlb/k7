// useLiveEnvelope.ts — the take being played, as an envelope that GROWS. The engine pushes input
// levels ~20×/s and nothing has written a file yet, so this is the only picture of a take while it
// is still being made; the file's own waveform replaces it the moment the recorder closes it.

import {
  INPUT_VU_MAX_DB,
  INPUT_VU_MIN_DB,
  useEngineStore,
} from "@studio/engine-browser/store";
import { useEffect, useRef, useState } from "react";

/** How long one engine frame stands for — the nominal, since a growing take is read for its SHAPE and not for its timings. */
export const LIVE_FRAME_MS = 50;

// Ten minutes at 20 Hz: a take that outruns it scrolls, where an unbounded envelope would redraw more slowly the longer you played.
const MAX_FRAMES = 12000;

// Every other frame reaches React: the engine's rate is the meters', and each update re-rasterises the whole contour.
const KEEP_EVERY = 2;

// One input dB reading mapped to 0..1, through the same range as the meters.
function level(db: number): number {
  const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const EMPTY: number[] = [];

/** The samples of the take currently rolling — ONE envelope, the loudest armed input per frame, cleared when a take STARTS. */
export function useLiveEnvelope(
  rolling: boolean,
  trackOrder: string[],
): { intervalMs: number; samples: number[] } {
  const store = useEngineStore();
  const [samples, setSamples] = useState<number[]>(EMPTY);
  const buf = useRef<number[]>([]);
  const n = useRef(0);
  // Read inside the subscription, which is bound once and must not be rebound on a transport change.
  const rollingRef = useRef(rolling);
  rollingRef.current = rolling;
  const orderRef = useRef(trackOrder);
  orderRef.current = trackOrder;

  // A new take starts from nothing. `rolling` going true is the only edge that clears.
  useEffect(() => {
    if (!rolling) return;
    buf.current = [];
    n.current = 0;
    setSamples(EMPTY);
  }, [rolling]);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      if (!rollingRef.current) return; // the take is over — it is a picture now
      const s = store.getSnapshot();
      let peak = 0;
      for (const id of s.armed) {
        const i = orderRef.current.indexOf(id);
        if (i >= 0) peak = Math.max(peak, level(s.inputLevels[i] ?? -Infinity));
      }
      buf.current.push(peak);
      if (buf.current.length > MAX_FRAMES) buf.current.shift();
      // A copy per update, because the Waveform memoises on the array's identity — mutating in place would redraw nothing.
      if (++n.current % KEEP_EVERY === 0) setSamples([...buf.current]);
    });
    return unsub;
  }, [store]);

  return { intervalMs: LIVE_FRAME_MS, samples };
}
