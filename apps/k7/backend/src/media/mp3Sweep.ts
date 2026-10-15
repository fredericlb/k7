// mp3Sweep.ts — every FLAC in the library gets a same-named MP3 beside it, made in the background
// one at a time, so `/stream` finds it ready instead of transcoding while a listener waits.
// Missing or older than its FLAC both count: a replaced FLAC must not keep playing the old take.
// Off where STUDIO_MP3_SWEEP is "0" — the user's own machine. See ../../docs/media/derivedMp3.md.

import { type Dirent, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  cacheDir,
  exists,
  familyDir,
  recordingsDir,
} from "@studio/mediatek/layout";
import { extOf } from "@studio/mediatek/media";
import { FAMILIES } from "@studio/mediatek/types";
import {
  ensureMp3,
  mp3IsFresh,
  NoFfmpegError,
  SourceChangedError,
} from "./transcode.ts";

/** Between two files: ffmpeg is a subprocess, but a pass should not saturate the CPU either. */
const GAP_MS = 250;

/** …and between two passes: a FLAC dropped on the volume by hand is what a new pass finds. */
const PASS_MS = 5 * 60_000;

export interface Mp3SweepState {
  /** Off by configuration, as on the desktop and the phone. */
  enabled: boolean;
  running: boolean;
  /** Absolute path of the FLAC being transcoded right now. */
  current: string | null;
  /** MP3s written since boot, and FLACs that threw and will not be tried again. */
  made: number;
  failed: string[];
  pending: number;
  /** `false` once ffmpeg was found missing: the sweep stops for good. */
  encoder: boolean;
}

const state: Omit<Mp3SweepState, "failed" | "enabled"> = {
  running: false,
  current: null,
  made: 0,
  pending: 0,
  encoder: true,
};

/** Tried and threw: retrying a FLAC ffmpeg cannot read would spend every pass on it. */
const failed = new Set<string>();

let timer: ReturnType<typeof setInterval> | null = null;

const enabled = (): boolean => process.env.STUDIO_MP3_SWEEP !== "0";

export const mp3SweepState = (): Mp3SweepState => ({
  ...state,
  enabled: enabled(),
  failed: [...failed],
});

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Every FLAC under the families and the capture zone whose MP3 is missing or stale. */
async function stale(): Promise<string[]> {
  const out: string[] = [];
  const dirs = [...FAMILIES.map(familyDir), recordingsDir()];
  while (dirs.length) {
    const dir = dirs.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (): Dirent[] => [],
    );
    for (const e of entries) {
      // Dot-entries are derived or hidden — `.cache`, a transcode's own `.part`.
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) dirs.push(p);
      else if (extOf(e.name) === ".flac" && !failed.has(p) && !mp3IsFresh(p))
        out.push(p);
    }
  }
  return out.sort();
}

/** One pass over the library — exported so a test can await what the timer otherwise fires. */
export async function pass(): Promise<void> {
  if (!state.encoder || state.running || !exists()) return;
  state.running = true;
  try {
    const todo = await stale();
    state.pending = todo.length;
    for (const abs of todo) {
      state.current = abs;
      try {
        await ensureMp3(abs);
        state.made++;
      } catch (e) {
        // No encoder is the deployment's problem, and every other FLAC would fail the same way.
        if (e instanceof NoFfmpegError) {
          state.encoder = false;
          console.error(`   mp3 sweep stopped: ${e.message}`);
          return;
        }
        // A FLAC that moved under ffmpeg is fine: the next pass finds it where it went.
        if (!(e instanceof SourceChangedError)) failed.add(abs);
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
export function startMp3Sweep(): void {
  if (timer || !enabled()) return;
  // A volume may still hold MP3s under `.cache/stream/`, which nothing reads: reclaimed at boot.
  rmSync(join(cacheDir(), "stream"), { recursive: true, force: true });
  timer = setInterval(() => void pass(), PASS_MS);
  timer.unref?.();
  void pass();
}
