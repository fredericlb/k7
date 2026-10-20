// poolWorker.ts — a waveform's file work on a thread of its own: a sidecar CHECKED (fingerprint, parse)
// or a source ANALYSED (decode, envelope, sidecar written), so neither holds every other request of the
// process. The pool that feeds it is pool.ts; bundled, this is analyse-worker.mjs. See docs/analysis.md.

import { parentPort } from "node:worker_threads";
import { analyseFile } from "./analyse.ts";
import { checkSidecar } from "./check.ts";

/** A job from the pool, or the cancel of one. */
type Message =
  | {
      type: "analyse";
      id: number;
      source: string;
      sensitivity: number;
      engineBin: string | null;
    }
  | { type: "check"; id: number; source: string; sensitivity?: number }
  | { type: "cancel"; id: number };

const running = new Map<number, AbortController>();

parentPort?.on("message", (m: Message) => {
  if (m.type === "cancel") {
    running.get(m.id)?.abort();
    return;
  }
  if (m.type === "check") {
    try {
      parentPort?.postMessage({
        id: m.id,
        value: checkSidecar(m.source, m.sensitivity),
      });
    } catch (e) {
      parentPort?.postMessage({ id: m.id, error: (e as Error).message });
    }
    return;
  }
  const abort = new AbortController();
  running.set(m.id, abort);
  analyseFile(m.source, m.sensitivity, {
    engineBin: m.engineBin,
    signal: abort.signal,
  })
    .then(
      (env) => parentPort?.postMessage({ id: m.id, value: env }),
      (e: Error) => parentPort?.postMessage({ id: m.id, error: e.message }),
    )
    .finally(() => running.delete(m.id));
});
