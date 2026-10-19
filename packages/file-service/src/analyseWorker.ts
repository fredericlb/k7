// analyseWorker.ts — a waveform analysis (decode, envelope, sidecar) on a thread of its own, so the
// envelope's loop over every sample does not hold every other request of the file service. The pool
// that feeds it is analysePool.ts; bundled, this is bin/analyse-worker.mjs. See docs/waveformCache.md.

import { parentPort } from "node:worker_threads";
import { analyseFile } from "@studio/audio-analysis/analyse";

/** A job from the pool, or the cancel of one. */
type Message =
  | {
      type: "analyse";
      id: number;
      source: string;
      sensitivity: number;
      engineBin: string | null;
    }
  | { type: "cancel"; id: number };

const running = new Map<number, AbortController>();

parentPort?.on("message", (m: Message) => {
  if (m.type === "cancel") {
    running.get(m.id)?.abort();
    return;
  }
  const abort = new AbortController();
  running.set(m.id, abort);
  analyseFile(m.source, m.sensitivity, {
    engineBin: m.engineBin,
    signal: abort.signal,
  })
    .then(
      (env) => parentPort?.postMessage({ id: m.id, env }),
      (e: Error) => parentPort?.postMessage({ id: m.id, error: e.message }),
    )
    .finally(() => running.delete(m.id));
});
