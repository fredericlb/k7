// waveformCache.ts — when a `{source}.cache` sidecar gets (re)built, and the memo in front of it.
// Building one is @studio/audio-analysis's, decoding through the engine where there is one and
// through ffmpeg where there is not. Clip-region slicing and the tempo grid stay in
// @studio/audio-probe/waveform. See docs/waveformCache.md.

import { statSync } from "node:fs";
import { DEFAULT_TRANSIENT_SENSITIVITY } from "@studio/audio-analysis/envelope";
import { fileFingerprint } from "@studio/audio-analysis/fingerprint";
import {
  analyseOffThread,
  checkSidecarOffThread,
} from "@studio/audio-analysis/pool";
import {
  cachePath,
  readSidecar,
  storedSensitivity,
} from "@studio/audio-analysis/sidecar";
import type { FileEnvelope } from "@studio/audio-probe/waveform";

// Re-exported so this module's importers keep resolving them; they are the sidecar's, not ours.
export {
  cachePath,
  DEFAULT_TRANSIENT_SENSITIVITY,
  fileFingerprint,
  storedSensitivity,
};

// --- (re)generation ----------------------------------------------------------------

// So a burst for one source doesn't re-read the sidecar: mtime is the cheap gate, the fingerprint stays the truth.
interface Memo {
  mtimeMs: number;
  env: FileEnvelope;
}
const memo = new Map<string, Memo>();

/**
 * The decodes running right now, keyed by source AND the sensitivity asked for. Two asks for one
 * file are ONE decode: a timeline drawing several lanes off the same take asks for it several times
 * at once, and without this each ask spawned its own engine over the same 33 MB — see
 * docs/waveformCache.md.
 */
const inFlight = new Map<string, Promise<FileEnvelope>>();

/** A fresh envelope: the memo, a matching sidecar, else a decode — see docs/waveformCache.md. */
export async function ensureFileEnvelope(
  source: string,
  engineBin: string | null,
  sensitivity?: number,
): Promise<FileEnvelope> {
  const mtimeMs = statSync(source).mtimeMs; // throws ENOENT for a missing source
  const usable = (e: FileEnvelope): boolean =>
    sensitivity === undefined || e.sensitivity === sensitivity;

  const hit = memo.get(source);
  if (hit && hit.mtimeMs === mtimeMs && usable(hit.env)) return hit.env;

  // The sidecar parsed whole and the file fingerprinted, on a worker: a burst of waveforms did it here, each in turn.
  const checked = await checkSidecarOffThread(source, sensitivity);
  if (checked.env) {
    memo.set(source, { mtimeMs, env: checked.env });
    return checked.env;
  }
  return sharedDecode(source, checked.sensitivity, engineBin);
}

/** The decodes queued behind each other on a local install, a phone's memory bound — docs/waveformCache.md. */
let decodeTail: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.STUDIO_LOCAL_USER !== "1") return fn();
  const run = decodeTail.then(fn, fn);
  decodeTail = run.catch(() => {});
  return run;
}

/** ONE decode per source and threshold, joined by a request and the prewarm alike — docs/waveformCache.md. */
async function sharedDecode(
  source: string,
  sensitivity: number,
  engineBin: string | null,
  signal?: AbortSignal,
): Promise<FileEnvelope> {
  // Joined rather than started again — the sidecar this leaves is the same one either way.
  const key = `${source}\u0000${sensitivity}`;
  const running = inFlight.get(key);
  if (running) return running;
  const mtimeMs = statSync(source).mtimeMs;
  const decode = (async (): Promise<FileEnvelope> => {
    // A null engineBin is the hosted service: ffmpeg decodes, as in pl8 (docs/waveformCache.md).
    // On a worker thread: the envelope loops over every sample, which would hold every other request.
    const env = await oneAtATime(() =>
      analyseOffThread(source, sensitivity, { engineBin, signal }),
    );
    memo.set(source, { mtimeMs, env });
    return env;
  })();
  inFlight.set(key, decode);
  try {
    return await decode;
  } finally {
    // Cleared here rather than in a `.finally` on the promise: a failed decode must not be joined either.
    inFlight.delete(key);
  }
}

// Drop the memo for one source (or all) when it changed underneath us, so the next request re-checks the sidecar.
export function invalidateEnvelope(source?: string): void {
  if (source) {
    memo.delete(source);
    freshMemo.delete(source);
  } else {
    memo.clear();
    freshMemo.clear();
  }
}

// --- batch (re)generation ----------------------------------------------------------

/** Size+mtime of a source and of its sidecar — the pair a "still fresh" verdict was made about. */
function pairStamp(source: string): string | null {
  try {
    const a = statSync(source);
    const b = statSync(cachePath(source));
    return `${a.size}:${a.mtimeMs}|${b.size}:${b.mtimeMs}`;
  } catch {
    return null; // no sidecar (or no source) — nothing to trust
  }
}

/** Sources judged fresh, against the stamp of the two files compared; only YES is remembered. */
const freshMemo = new Map<string, string>();

// Is `source`'s sidecar present and still matching the file's current content?
function cacheFresh(source: string): boolean {
  const stamp = pairStamp(source);
  if (stamp && freshMemo.get(source) === stamp) return true;
  const c = readSidecar(source);
  const ok = !!c && c.fingerprint === fileFingerprint(source);
  if (ok && stamp) freshMemo.set(source, stamp);
  else freshMemo.delete(source);
  return ok;
}

// The distinct sources whose sidecar is missing or stale — the work a prewarm actually needs; a missing file drops.
export function staleWaveformSources(sources: string[]): string[] {
  const out: string[] = [];
  for (const s of new Set(sources)) {
    try {
      statSync(s); // skip a source that no longer exists
      if (!cacheFresh(s)) out.push(s);
    } catch {
      /* missing / unreadable — skip; the on-demand path surfaces it */
    }
  }
  return out;
}

/** How many files a prewarm decodes at once: each holds a mono copy of its file, ~57 MB for five minutes. */
const WARM_DECODES = 2;

// Rebuild every stale sidecar, a few at a time; `onResult` fires per file for a live count.
export async function runWaveformBatch(
  engineBin: string | null,
  sources: string[],
  onResult?: (source: string, ok: boolean) => void,
  signal?: AbortSignal,
): Promise<void> {
  const queue = [...sources];
  const worker = async (): Promise<void> => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
      if (signal?.aborted) return;
      // The threshold the PREVIOUS sidecar carried, so a prewarm never quietly resets a tuned one.
      const ok = await sharedDecode(
        s,
        storedSensitivity(s) ?? DEFAULT_TRANSIENT_SENSITIVITY,
        engineBin,
        signal,
      ).then(
        () => true,
        () => false,
      );
      freshMemo.delete(s); // its stamp changed: the next freshness check re-reads it
      if (!signal?.aborted) onResult?.(s, ok);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WARM_DECODES, queue.length) }, worker),
  );
}
