// wav.ts — the one wav reader and writer the render harnesses share. The reader walks the RIFF
// chunks rather than assuming a 44-byte header, and decodes PCM 16/24/32 and float32 to [-1, 1).
// The writer is a plain 44-byte PCM header in front of interleaved samples the caller made.

import { readFileSync } from "node:fs";

/** A decoded wav: its format, its data chunk, and one sample by frame and channel. */
export interface Wav {
  rate: number;
  channels: number;
  bits: number;
  /** 1 = PCM, 3 = IEEE float. */
  format: number;
  frames: number;
  /** The data chunk's bytes, interleaved as written. */
  data: Buffer;
  /** One sample, as a float in [-1, 1). */
  at(frame: number, channel: number): number;
}

/** Read a wav from a path or from its bytes; throws on a missing data chunk or an unknown sample format. */
export function readWav(file: string | Buffer): Wav {
  const b = typeof file === "string" ? readFileSync(file) : file;
  const name = typeof file === "string" ? file : "wav";
  let fmt = { format: 1, channels: 1, rate: 0, bits: 16 };
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ")
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    else if (id === "data") {
      const { format, channels, rate, bits } = fmt;
      const bytes = bits / 8;
      const data = b.subarray(body, Math.min(b.length, body + size));
      const frames = Math.floor(data.length / (bytes * channels));
      const read = sampleReader(data, format, bits, name);
      return {
        rate,
        channels,
        bits,
        format,
        frames,
        data,
        at: (f, c) => read((f * channels + c) * bytes),
      };
    }
    at = body + size + (size & 1);
  }
  throw new Error(`${name}: no data chunk`);
}

function sampleReader(
  d: Buffer,
  format: number,
  bits: number,
  name: string,
): (offset: number) => number {
  if (format === 3 && bits === 32) return (o) => d.readFloatLE(o);
  if (bits === 16) return (o) => d.readInt16LE(o) / 32768;
  if (bits === 24) return (o) => d.readIntLE(o, 3) / 8388608;
  if (bits === 32) return (o) => d.readInt32LE(o) / 2147483648;
  throw new Error(`${name}: unsupported ${bits}-bit format ${format}`);
}

/** One channel of a wav as floats — the first unless told otherwise. */
export function channelOf(w: Wav, channel = 0): Float32Array {
  const x = new Float32Array(w.frames);
  for (let f = 0; f < w.frames; f++) x[f] = w.at(f, channel);
  return x;
}

/** A PCM wav file's bytes: a 44-byte header in front of `data`, interleaved samples of `bits` each. */
export function wavFile(
  data: Buffer,
  rate: number,
  channels: number,
  bits: number,
): Buffer {
  const frame = (bits / 8) * channels;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * frame, 28);
  h.writeUInt16LE(frame, 32);
  h.writeUInt16LE(bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
