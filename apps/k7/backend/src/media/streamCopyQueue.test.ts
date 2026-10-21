// The encode queue is bounded: past MAX_ENCODES running and MAX_WAITING queued, a FLAC is refused.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// A stand-in encoder that takes its time, then writes the copy.
vi.mock("@studio/audio-analysis/pool", () => ({
  transcodeOffThread: (_pieces: unknown, dest: string) =>
    new Promise((ok) =>
      setTimeout(() => {
        writeFileSync(dest, "webm");
        ok({ frames: 1, sampleRate: 48_000, gainDb: 0 });
      }, 150),
    ),
}));

const {
  encodeLoad,
  ensureStreamCopy,
  MAX_ENCODES,
  MAX_WAITING,
  StreamCopyBusyError,
} = await import("./streamCopy.ts");

const dir = mkdtempSync(join(tmpdir(), "stream-queue-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the encode queue", () => {
  it("runs MAX_ENCODES, queues MAX_WAITING, and refuses the next", async () => {
    const flacs = Array.from(
      { length: MAX_ENCODES + MAX_WAITING + 1 },
      (_, i) => {
        const f = join(dir, `t${i}.flac`);
        writeFileSync(f, "flac");
        return f;
      },
    );
    const last = flacs.pop() as string;
    const all = flacs.map((f) => ensureStreamCopy(f));
    await new Promise((ok) => setTimeout(ok, 0));
    expect(encodeLoad()).toEqual({ active: MAX_ENCODES, waiting: MAX_WAITING });
    await expect(ensureStreamCopy(last)).rejects.toThrow(StreamCopyBusyError);
    await Promise.all(all);
    expect(encodeLoad()).toEqual({ active: 0, waiting: 0 });
  });
});
