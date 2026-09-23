// performance.ts — measures this machine once, for the rating the heartbeat carries. Short on
// purpose (well under a second) and run before the engine starts, so the CPU loop is not
// measuring a plugin scan. The scoring itself is @studio/web-protocol/performance's, so the
// browser and the supervisor cannot disagree on it. See web-protocol/docs/performance.md.

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  writeSync,
} from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import {
  type EnginePerformance,
  enginePerformance,
} from "@studio/web-protocol/performance";

const BLOCK = 4096;
const CPU_BUDGET_MS = 200;
const WRITE_BYTES = 16 * 1024 * 1024;
const WRITE_CHUNK = 1024 * 1024;
const FSYNC_COUNT = 32;

/** Millions of samples per second through a biquad on ONE core — the shape of the work an audio callback does. */
export function measureSingleThread(budgetMs = CPU_BUDGET_MS): number {
  const buf = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) buf[i] = Math.sin(i * 0.05);
  // A lowpass at ~1 kHz / 48 kHz; the coefficients matter only in staying stable.
  const b0 = 0.0039,
    b1 = 0.0078,
    b2 = 0.0039,
    a1 = -1.8153,
    a2 = 0.8309;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const pass = (): void => {
    for (let i = 0; i < BLOCK; i++) {
      const x = buf[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      buf[i] = y;
    }
  };
  // Warm the JIT first: an interpreted pass would rate the compiler, not the core.
  for (let i = 0; i < 200; i++) pass();
  let samples = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < budgetMs) {
    for (let i = 0; i < 50; i++) pass();
    samples += 50 * BLOCK;
    elapsed = performance.now() - start;
  }
  if (!Number.isFinite(y1)) return 0; // keeps the loop observable, so it cannot be optimised away
  return samples / elapsed / 1000;
}

/** Sustained durable write and small-fsync rate in `dir`. Reads are not measured: the page cache would answer them. */
export function measureDisk(dir: string): {
  diskWriteMBps: number | null;
  fsyncPerSec: number | null;
} {
  const file = join(dir, `.perf-probe-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    const chunk = Buffer.alloc(WRITE_CHUNK, 0x5a);
    let fd = openSync(file, "w");
    let start = performance.now();
    try {
      for (let n = 0; n < WRITE_BYTES; n += WRITE_CHUNK) writeSync(fd, chunk);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const writeMs = performance.now() - start;

    const small = chunk.subarray(0, BLOCK);
    fd = openSync(file, "w");
    start = performance.now();
    try {
      for (let i = 0; i < FSYNC_COUNT; i++) {
        writeSync(fd, small);
        fsyncSync(fd);
      }
    } finally {
      closeSync(fd);
    }
    const fsyncMs = performance.now() - start;
    return {
      diskWriteMBps: WRITE_BYTES / (1024 * 1024) / (writeMs / 1000),
      fsyncPerSec: FSYNC_COUNT / (fsyncMs / 1000),
    };
  } catch {
    return { diskWriteMBps: null, fsyncPerSec: null }; // read-only or full: unknown, not slow
  } finally {
    rmSync(file, { force: true });
  }
}

/** The whole rating, measured against the disk `dir` lives on — the state dir, where takes are written. */
export function measurePerformance(dir: string): EnginePerformance {
  return enginePerformance({
    cores: availableParallelism(),
    singleThread: measureSingleThread(),
    ...measureDisk(dir),
    memoryGB: totalmem() / 1024 ** 3,
  });
}
