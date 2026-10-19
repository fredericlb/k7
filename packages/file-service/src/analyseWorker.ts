// analyseWorker.ts — a waveform's file work on a thread of its own: a sidecar CHECKED (fingerprint, parse)
// or a source ANALYSED (decode, envelope, sidecar written), so neither holds every other request of the
// file service. The pool that feeds it is analysePool.ts; bundled, this is bin/analyse-worker.mjs. See docs/waveformCache.md.

import { parentPort } from "node:worker_threads";
import { analyseFile } from "@studio/audio-analysis/analyse";
import { checkSidecar } from "./sidecarCheck.ts";

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
