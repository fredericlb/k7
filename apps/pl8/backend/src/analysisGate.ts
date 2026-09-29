// analysisGate.ts — every decode this process runs goes through here: one per file at a time, and at
// most MAX_DECODES at once. A decode holds the file's whole mono signal (~1.4 GB for two hours at 48
// kHz), and a listener flipping through songs asks for one per song (../../docs/audit.md).
// The one thing a reader would get wrong: a FRESH sidecar never queues — only real decodes wait.

import { analyseFile, freshSidecar } from "@studio/audio-analysis/analyse";

type FileEnvelope = Awaited<ReturnType<typeof analyseFile>>;

/** Decodes in flight at once, across the routes and the background sweep. */
export const MAX_DECODES = 2;

let active = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<FileEnvelope>>();

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_DECODES) await new Promise<void>((go) => waiting.push(go));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Measure `source` now, sharing a decode of the same file already running or queued. */
export function analyseShared(source: string): Promise<FileEnvelope> {
  const running = inflight.get(source);
  if (running) return running;
  const p = slot(() => analyseFile(source)).finally(() =>
    inflight.delete(source),
  );
  inflight.set(source, p);
  return p;
}

/** The sidecar when it still matches the file, else a shared, gated decode. */
export async function ensureAnalysedShared(
  source: string,
): Promise<FileEnvelope> {
  return freshSidecar(source) ?? analyseShared(source);
}

/** How many decodes run and wait — for the tests, and for `/analysis`. */
export const gateLoad = (): { active: number; waiting: number } => ({
  active,
  waiting: waiting.length,
});
