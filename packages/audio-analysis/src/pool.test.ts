// pool.test.ts — the worker pool: an analysis past its deadline is refused and its worker killed, a job whose
// worker dies under it fails, and the pool goes on with a fresh worker either way.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyseOffThread,
  DeadlineError,
  poolWorkers,
  TranscodeDeadlineError,
  transcodeOffThread,
} from "./pool.ts";

const dir = mkdtempSync(join(tmpdir(), "analysis-pool-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A 16-bit mono wav of a 110 Hz tone. */
function wav(name: string, seconds: number): string {
  const rate = 44_100;
  const frames = seconds * rate;
  const b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + frames * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(frames * 2, 40);
  for (let f = 0; f < frames; f++)
    b.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 110 * f) / rate)),
      44 + f * 2,
    );
  const path = join(dir, name);
  writeFileSync(path, b);
  return path;
}

describe("the analysis pool", () => {
  it("refuses an analysis past its deadline, then analyses the next one", async () => {
    const src = wav("tone.wav", 20);
    await expect(
      analyseOffThread(src, 0.5, { engineBin: null, deadlineMs: 1 }),
    ).rejects.toBeInstanceOf(DeadlineError);
    const env = await analyseOffThread(src, 0.5, { engineBin: null });
    expect(env.seconds).toBeCloseTo(20, 1);
  });

  it("transcodes on a worker, and leaves nothing behind past a deadline", async () => {
    const src = wav("long.wav", 30);
    const out = join(dir, "out.webm");
    await expect(
      transcodeOffThread(
        [{ source: src }],
        out,
        { kind: "opus" },
        { deadlineMs: 1 },
      ),
    ).rejects.toBeInstanceOf(TranscodeDeadlineError);
    await new Promise((r) => setTimeout(r, 200));
    expect(readdirSync(dir).filter((f) => f.includes("out.webm"))).toEqual([]);
    const r = await transcodeOffThread(
      [{ source: src }],
      out,
      { kind: "opus" },
      { deadlineMs: 60_000 },
    );
    expect(r.frames).toBe(30 * 48_000);
  });

  it("fails the job whose worker died, and analyses the next one on a fresh worker", async () => {
    const src = wav("crash.wav", 60);
    await analyseOffThread(src, 0.5, { engineBin: null });
    const doomed = analyseOffThread(src, 0.5, { engineBin: null });
    const [worker] = poolWorkers("analyse");
    void worker.terminate();
    await expect(doomed).rejects.toMatchObject({ name: "WorkerDiedError" });
    const env = await analyseOffThread(src, 0.5, { engineBin: null });
    expect(env.seconds).toBeCloseTo(60, 1);
    expect(poolWorkers("analyse")).not.toContain(worker);
  });
});
