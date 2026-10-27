// useShaderParam.ts — a shader's knob turned on a card: `node param` on its node, the picture rebuilt
// from the file. A drag calls back once per frame, so each knob writes at most every WAIT ms, the
// LAST value always landing (packages/song/docs/videoMixer.md).

import { useEffect, useMemo } from "react";
import { useLatest } from "./useLatest";

/** How long a knob's writes are held, so a drag is a few file writes rather than one per frame. */
const WAIT_MS = 120;

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

/** The shell's `onShaderParam`, writing through `run` — the quiet command runner, since a knob is no event. */
export function useShaderParam(
  run: (line: string) => unknown,
): (module: string, name: string, value: number) => void {
  const runRef = useLatest(run);
  const writer = useMemo(
    () =>
      throttledParams((module, name, value) =>
        runRef.current(
          `node param ${JSON.stringify(module)} ${name} ${Number(value.toFixed(3))}`,
        ),
      ),
    [runRef],
  );
  useEffect(() => () => writer.flushAll(), [writer]);
  return writer.set;
}
