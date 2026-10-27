// useShaderParam.ts — a shader's knob turned on a card: the viewport takes it AT ONCE (pictureLive.ts),
// and `node param` writes it to the node, at most every WAIT ms per knob, the LAST value always
// landing. The picture is read back once the writes stop (packages/song/docs/videoMixer.md).

import { pushShaderParam } from "@studio/k7-plugins/video";
import { useEffect, useMemo, useRef } from "react";
import { useLatest } from "./useLatest";

/** How long a knob's writes are held, so a drag is a few file writes rather than one per frame. */
const WAIT_MS = 120;
/** How long after the last write the picture is read back — once per drag, not per write. */
const SETTLE_MS = 300;

/** One writer per knob: the value the timer finds is the one written, and nothing is left behind. */
export function throttledParams(
  send: (module: string, name: string, value: number) => void,
  wait = WAIT_MS,
) {
  const pending = new Map<
    string,
    { module: string; name: string; value: number }
  >();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const flush = (key: string) => {
    timers.delete(key);
    const p = pending.get(key);
    pending.delete(key);
    if (p) send(p.module, p.name, p.value);
  };
  return {
    set(module: string, name: string, value: number) {
      const key = `${module}\u0000${name}`;
      pending.set(key, { module, name, value });
      if (!timers.has(key))
        timers.set(
          key,
          setTimeout(() => flush(key), wait),
        );
    },
    /** Write whatever is held now — what an unmount owes the file. */
    flushAll() {
      for (const [key, t] of [...timers]) {
        clearTimeout(t);
        flush(key);
      }
    },
  };
}

/** The shell's `onShaderParam`: live to the viewport, written through `run` (the QUIET runner, a knob being no event), then `settled`. */
export function useShaderParam(
  run: (line: string) => unknown,
  settled: () => void,
): (module: string, name: string, value: number) => void {
  const runRef = useLatest(run);
  const settledRef = useLatest(settled);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A knob no viewport could draw: its pass appears only with the picture read back, so that read is not left for the end.
  const unseen = useRef(false);
  const writer = useMemo(
    () =>
      throttledParams(async (module, name, value) => {
        await runRef.current(
          `node param ${JSON.stringify(module)} ${name} ${Number(value.toFixed(3))}`,
        );
        // A quiet command reloads nothing, so the picture is read back here — at once when the drag had no pass to move.
        if (settle.current) clearTimeout(settle.current);
        if (unseen.current) {
          unseen.current = false;
          settledRef.current();
        } else
          settle.current = setTimeout(() => settledRef.current(), SETTLE_MS);
      }),
    [runRef, settledRef],
  );
  useEffect(() => () => writer.flushAll(), [writer]);
  return useMemo(
    () => (module: string, name: string, value: number) => {
      if (!pushShaderParam(module, name, value)) unseen.current = true;
      writer.set(module, name, value);
    },
    [writer],
  );
}
