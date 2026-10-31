import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sliceWav, wavHeader, wavLayout } from "./wavSlice.ts";

const dir = mkdtempSync(join(tmpdir(), "k7-wavslice-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A mono 16-bit `fmt ` body at `rate`. */
function pcmFormat(rate: number): Buffer {
  const f = Buffer.alloc(16);
  f.writeUInt16LE(1, 0);
  f.writeUInt16LE(1, 2);
  f.writeUInt32LE(rate, 4);
  f.writeUInt32LE(rate * 2, 8);
  f.writeUInt16LE(2, 12);
  f.writeUInt16LE(16, 14);
  return f;
}

/** A WAV whose sample n holds n, with a LIST chunk before its data, as many recorders write. */
function wav(frames: number, rate: number, opts: { unclosed?: boolean } = {}) {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(i, i * 2);
  const list = Buffer.from("LIST\x04\x00\x00\x00INFO", "latin1");
  const head = wavHeader(pcmFormat(rate), opts.unclosed ? 0 : data.length);
  const fmtEnd = head.length - 8;
  return Buffer.concat([
    head.subarray(0, fmtEnd),
    list,
    head.subarray(fmtEnd),
    data,
  ]);
}

describe("a WAV's layout", () => {
  it("finds the samples past other chunks", () => {
    const b = wav(10, 1000);
    const w = wavLayout(b, b.length);
    expect(w).toMatchObject({ blockAlign: 2, sampleRate: 1000, dataBytes: 20 });
    expect(b.readInt16LE((w?.dataOffset ?? 0) + 4)).toBe(2);
  });

  it("reads an unclosed file's data as what is there", () => {
    const b = wav(10, 1000, { unclosed: true });
    expect(wavLayout(b, b.length)?.dataBytes).toBe(20);
  });

  it("is none for a WebM or a compressed WAV", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(wavLayout(webm, webm.length)).toBeNull();
    const b = wav(10, 1000);
    b.writeUInt16LE(85, 20);
    expect(wavLayout(b, b.length)).toBeNull();
  });
});

describe("a WAV's slice", () => {
  it("copies whole frames of the span under its own header, and says where it starts", async () => {
    const src = join(dir, "take.wav");
    writeFileSync(src, wav(1000, 1000));
    const out = join(dir, "slice.wav");
    expect(await sliceWav(src, 0.1004, 0.2, out)).toEqual({ startSec: 0.1 });
    const b = readFileSync(out);
    const w = wavLayout(b, b.length);
    expect(w?.dataBytes).toBe(200);
    expect(b.readInt16LE(w?.dataOffset ?? 0)).toBe(100);
    expect(b.readUInt32LE(4)).toBe(b.length - 8);
  });

  it("is none for a file that is no WAV", async () => {
    const src = join(dir, "take.webm");
    writeFileSync(src, Buffer.alloc(64, 1));
    expect(await sliceWav(src, 0, 1, join(dir, "x.wav"))).toBeNull();
  });
});
