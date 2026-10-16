// analysisSweep.ts — the songs with no `{file}.cache` beside them, measured one at a time in
// the background, so opening a song finds its waveform already there instead of waiting for a
// decode. This server holds the bytes and has ffmpeg, so nothing is asked of an engine.
// It fills ABSENCES only: a sidecar that no longer matches its file is the player's business,
// not a sweep's. See ../../docs/media/analysis.md.

import { join } from "node:path";
import { sidecarPresent } from "@studio/audio-analysis/sidecar";
import { NoFfmpegError } from "@studio/ffmpeg";
import { listFamily } from "@studio/mediatek/catalogue";
import { exists, mediatekDir } from "@studio/mediatek/layout";
import { analyseShared, gateLoad } from "./analysisGate.ts";
import { markedFailed } from "./analysisMarks.ts";

/** Between two files. The decode is a subprocess, but the envelope is ~200 ms of SYNCHRONOUS arithmetic. */
const GAP_MS = 250;

/** …and between two passes: a file dropped on the volume by hand is the only thing a new pass finds. */
const PASS_MS = 5 * 60_000;

export interface SweepState {
  /** Whether a pass is walking right now, and what it is on — a mediatek-relative path. */
  running: boolean;
  current: string | null;
  /** Sidecars written since boot, and files that threw and will not be tried again. */
  analysed: number;
  failed: string[];
  /** What the last pass found missing when it started. */
  pending: number;
  /** `false` once a decode said there is no ffmpeg here: the sweep stops for good. */
  decoder: boolean;
}

const state: SweepState = {
  running: false,
  current: null,
  analysed: 0,
  failed: [],
  pending: 0,
  decoder: true,
};

/** Tried and threw: retrying a file that cannot be decoded would spend the whole sweep on it. */
const failed = new Set<string>();

let timer: ReturnType<typeof setInterval> | null = null;

export const sweepState = (): SweepState & ReturnType<typeof gateLoad> => ({
  ...state,
  failed: [...failed],
  ...gateLoad(),
});

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** A song's playable file, mediatek-relative — the entry names its folder, the meta the file in it. */
function masterOf(entry: {
  path: string;
  meta?: Record<string, unknown>;
}): string | null {
  const master = entry.meta?.master;
  return typeof master === "string" && master
    ? `${entry.path}/${master}`
    : null;
}

/** Every catalogued song whose master has no sidecar at all, in listing order. */
async function missing(): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await listFamily("songs")).entries) {
    const rel = masterOf(entry);
    if (!rel || failed.has(rel)) continue;
    const abs = join(mediatekDir(), rel);
    // A mark on the volume outlives a restart, where `failed` does not.
    if (!sidecarPresent(abs) && !markedFailed(abs)) out.push(rel);
  }
  return out;
}

async function pass(): Promise<void> {
  if (!state.decoder || state.running || !exists()) return;
  state.running = true;
  try {
    const todo = await missing();
    state.pending = todo.length;
    for (const rel of todo) {
      state.current = rel;
      try {
        // Behind the routes' own decodes, and shared with one a listener already started on this file.
        await analyseShared(join(mediatekDir(), rel));
        state.analysed++;
      } catch (e) {
        // No decoder is the deployment's problem and every other file would fail the same way.
        if (e instanceof NoFfmpegError) {
          state.decoder = false;
          console.error(`   waveform sweep stopped: ${(e as Error).message}`);
          return;
        }
        failed.add(rel);
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

/**
 * Start sweeping, and keep sweeping every `PASS_MS`. Idempotent and `unref`ed, so it never holds
 * the process open and never runs two passes at once.
 */
export function startAnalysisSweep(): void {
  if (timer) return;
  timer = setInterval(() => void pass(), PASS_MS);
  timer.unref?.();
  void pass();
}
