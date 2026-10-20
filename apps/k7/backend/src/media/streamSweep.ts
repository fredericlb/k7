// streamSweep.ts — every FLAC in the library gets a same-named Opus copy beside it, made in the background
// one at a time, so `/stream` finds it ready instead of encoding while a listener waits.
// Missing or older than its FLAC both count: a replaced FLAC must not keep playing the old take.
// Off where STUDIO_STREAM_SWEEP is "0" — the user's own machine. See ../../docs/media/derivedStream.md.

import { type Dirent, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  cacheDir,
  exists,
  familyDir,
  recordingsDir,
} from "@studio/mediatek/layout";
import { derivedNamesOf, extOf } from "@studio/mediatek/media";
import { FAMILIES } from "@studio/mediatek/types";
import {
  copyIsFresh,
  ensureStreamCopy,
  SourceChangedError,
  StreamCopyBusyError,
} from "./streamCopy.ts";

/** Between two files: the encode runs on a worker, but a pass should not saturate the CPU either. */
const GAP_MS = 250;

/** …and between two passes: a FLAC dropped on the volume by hand is what a new pass finds. */
const PASS_MS = 5 * 60_000;

export interface StreamSweepState {
  /** Off by configuration, as on the desktop and the phone. */
  enabled: boolean;
  running: boolean;
  /** Absolute path of the FLAC being encoded right now. */
  current: string | null;
  /** Copies written since boot, and FLACs that threw and will not be tried again. */
  made: number;
  failed: string[];
  pending: number;
}

const state: Omit<StreamSweepState, "failed" | "enabled"> = {
  running: false,
  current: null,
  made: 0,
  pending: 0,
};

/** Tried and threw: retrying a FLAC the decoder cannot read would spend every pass on it. */
const failed = new Set<string>();

let timer: ReturnType<typeof setInterval> | null = null;

const enabled = (): boolean => process.env.STUDIO_STREAM_SWEEP !== "0";

export const streamSweepState = (): StreamSweepState => ({
  ...state,
  enabled: enabled(),
  failed: [...failed],
});

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Every FLAC under the families and the capture zone whose copy is missing or stale; a legacy MP3 beside one goes. */
async function stale(): Promise<string[]> {
  const out: string[] = [];
  const dirs = [...FAMILIES.map(familyDir), recordingsDir()];
  while (dirs.length) {
    const dir = dirs.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (): Dirent[] => [],
    );
    for (const e of entries) {
      // Dot-entries are derived or hidden — `.cache`, an encode's own `.part`.
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) dirs.push(p);
      else if (extOf(e.name) === ".flac") {
        // The MP3 an older backend derived: nothing streams it any more.
        const legacy = derivedNamesOf(p).find((d) => extOf(d) === ".mp3");
        if (legacy && existsSync(legacy)) rmSync(legacy, { force: true });
        if (!failed.has(p) && !copyIsFresh(p)) out.push(p);
      }
    }
  }
  return out.sort();
}

/** One pass over the library — exported so a test can await what the timer otherwise fires. */
export async function pass(): Promise<void> {
  if (state.running || !exists()) return;
  state.running = true;
  try {
    const todo = await stale();
    state.pending = todo.length;
    for (const abs of todo) {
      state.current = abs;
      try {
        await ensureStreamCopy(abs);
        state.made++;
      } catch (e) {
        // A FLAC that moved under the encoder is fine: the next pass finds it where it went.
        if (
          !(e instanceof SourceChangedError || e instanceof StreamCopyBusyError)
        )
          failed.add(abs);
      }
      state.pending--;
      state.current = null;
      await wait(GAP_MS);
    }
  } finally {
    state.running = false;
    state.current = null;
  }
}

/** Start sweeping, and again every `PASS_MS`. Idempotent and `unref`ed, one pass at a time. */
export function startStreamSweep(): void {
  if (timer || !enabled()) return;
  // A volume may still hold copies under `.cache/stream/`, which nothing reads: reclaimed at boot.
  rmSync(join(cacheDir(), "stream"), { recursive: true, force: true });
  timer = setInterval(() => void pass(), PASS_MS);
  timer.unref?.();
  void pass();
}
