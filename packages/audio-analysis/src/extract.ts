// extract.ts — a media file's first audio stream, written out as a 32-bit float WAV at its own
// rate and channel count. ffmpeg first, since it opens every container a browser records; the
// engine's `--decode` when there is no ffmpeg, which reads video containers on macOS and Windows
// only. Nothing is resampled or mixed down. See docs/analysis.md.

import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import {
  type DecodeOptions,
  decodeFrames,
  NoFfmpegError,
  type StreamFacts,
} from "./decode";

const HEADER = 44;

// The RIFF header of a float WAV holding `frames` frames; written last, once the count is known.
function wavHeader(f: StreamFacts): Buffer {
  const data = f.frames * f.channels * 4;
  const h = Buffer.alloc(HEADER);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  h.writeUInt16LE(f.channels, 22);
  h.writeUInt32LE(f.sampleRate, 24);
  h.writeUInt32LE(f.sampleRate * f.channels * 4, 28);
  h.writeUInt16LE(f.channels * 4, 32);
  h.writeUInt16LE(32, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data, 40);
  return h;
}

// One decoder's attempt, into a temporary file renamed over `dest` only when it finished.
async function extractWith(
  source: string,
  dest: string,
  options: DecodeOptions,
): Promise<StreamFacts> {
  const tmp = `${dest}.part`;
  const fd = openSync(tmp, "w");
  let open = true;
  try {
    writeSync(fd, Buffer.alloc(HEADER));
    const facts = await decodeFrames(
      source,
      (samples, channels, frames) => {
        writeSync(
          fd,
          new Uint8Array(
            samples.buffer,
            samples.byteOffset,
            frames * channels * 4,
          ),
        );
      },
      options,
    );
    writeSync(fd, wavHeader(facts), 0, HEADER, 0);
    closeSync(fd);
    open = false;
    renameSync(tmp, dest);
    return facts;
  } catch (e) {
    if (open) closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Write `source`'s sound to `dest`; null when the file HAS no audio stream, which is a silent film rather than a fault. */
export async function extractSound(
  source: string,
  dest: string,
  { engineBin = null, signal }: DecodeOptions = {},
): Promise<StreamFacts | null> {
  try {
    return await extractWith(source, dest, { engineBin: null, signal });
  } catch (e) {
    if (/no audio stream/.test((e as Error).message)) return null;
    if (!(e instanceof NoFfmpegError) || !engineBin) throw e;
  }
  return extractWith(source, dest, { engineBin, signal });
}
