// wavSlice.ts — a span of a PCM WAV copied out byte for byte under a header of its own: no decode, no encode.
// What a local instance sends a server to consolidate a moment from, when its recording is a WAV (../docs/momentShare.md).
// What reads wrong: the span widens to whole frames, so the slice starts at `startSec` rounded DOWN, which it returns.

import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export interface WavLayout {
  /** The `fmt ` chunk's body, copied as it is into the slice. */
  format: Buffer;
  dataOffset: number;
  dataBytes: number;
  blockAlign: number;
  sampleRate: number;
}

/** How much of the file's head is read to find its chunks: a WAV's metadata chunks sit before `data`. */
const HEAD_BYTES = 64 * 1024;

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/** Whether a `fmt ` body describes uncompressed samples, the only kind cut by bytes. */
function isPlain(fmt: Buffer): boolean {
  const tag = fmt.readUInt16LE(0);
  if (tag === PCM || tag === FLOAT) return true;
  // The sub-format GUID starts with the plain format tag it stands for.
  if (tag === EXTENSIBLE && fmt.length >= 26) {
    const sub = fmt.readUInt16LE(24);
    return sub === PCM || sub === FLOAT;
  }
  return false;
}

/** Where a PCM WAV's samples are, from its head and its size on disk; null for anything else. */
export function wavLayout(head: Buffer, fileSize: number): WavLayout | null {
  if (
    head.length < 12 ||
    head.toString("ascii", 0, 4) !== "RIFF" ||
    head.toString("ascii", 8, 12) !== "WAVE"
  )
    return null;
  let at = 12;
  let format: Buffer | null = null;
  while (at + 8 <= head.length) {
    const id = head.toString("ascii", at, at + 4);
    const size = head.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      if (size < 16 || body + size > head.length) return null;
      format = Buffer.from(head.subarray(body, body + size));
    } else if (id === "data") {
      if (!format || !isPlain(format)) return null;
      const blockAlign = format.readUInt16LE(12);
      const sampleRate = format.readUInt32LE(4);
      if (!blockAlign || !sampleRate) return null;
      const there = Math.max(0, fileSize - body);
      // A recorder that never closed its file leaves the size at 0 or past the end: what is there is the data.
      const dataBytes =
        size === 0 || size > there ? there - (there % blockAlign) : size;
      return { format, dataOffset: body, dataBytes, blockAlign, sampleRate };
    }
    at = body + size + (size & 1);
  }
  return null;
}

/** The header of a WAV holding `dataBytes` of samples in `format`. */
export function wavHeader(format: Buffer, dataBytes: number): Buffer {
  const pad = format.length & 1;
  const h = Buffer.alloc(12 + 8 + format.length + pad + 8);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(h.length - 8 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(format.length, 16);
  format.copy(h, 20);
  const data = 20 + format.length + pad;
  h.write("data", data, "ascii");
  h.writeUInt32LE(dataBytes, data + 4);
  return h;
}

/** [startSec, endSec] of the WAV at `src` into `out`; where the slice starts, or null when `src` is no PCM WAV. */
export async function sliceWav(
  src: string,
  startSec: number,
  endSec: number,
  out: string,
): Promise<{ startSec: number } | null> {
  const size = (await stat(src)).size;
  const fd = await open(src, "r");
  let head: Buffer;
  try {
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, size));
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
  const w = wavLayout(head, size);
  if (!w) return null;
  const frames = Math.floor(w.dataBytes / w.blockAlign);
  const f0 = Math.min(frames, Math.max(0, Math.floor(startSec * w.sampleRate)));
  const f1 = Math.min(frames, Math.max(f0, Math.ceil(endSec * w.sampleRate)));
  if (f1 <= f0) return null;
  const bytes = (f1 - f0) * w.blockAlign;
  const from = w.dataOffset + f0 * w.blockAlign;
  const sink = createWriteStream(out);
  sink.write(wavHeader(w.format, bytes));
  await pipeline(
    createReadStream(src, { start: from, end: from + bytes - 1 }),
    sink,
  );
  return { startSec: f0 / w.sampleRate };
}
