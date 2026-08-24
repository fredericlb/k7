// wavLength.ts — how long a wav is, read from its header. Written by hand for the same reason
// separateAudio's writer is: a chunk walk is smaller than the argument for a dependency, and
// the one caller needs a number rather than samples.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** As much of a header as any sane file spends before `data` — a `LIST`/`bext` block and change. */
const HEAD_BYTES = 8192;

/** The duration of a RIFF/WAVE file in seconds, or NULL when it cannot be read — docs/rendering.md. */
export function wavSeconds(path: string): number | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buf, 0, HEAD_BYTES, 0);
    if (read < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buf.toString("ascii", 8, 12) !== "WAVE") return null;
    let off = 12;
    let rate = 0;
    let channels = 0;
    let bits = 0;
    while (off + 8 <= read) {
      const id = buf.toString("ascii", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === "fmt " && off + 24 <= read) {
        channels = buf.readUInt16LE(off + 10);
        rate = buf.readUInt32LE(off + 12);
        bits = buf.readUInt16LE(off + 22);
      }
      if (id === "data") {
        const frameBytes = (channels * bits) / 8;
        if (!(frameBytes > 0) || !(rate > 0)) return null;
        // Through the SAME descriptor, so a replaced file cannot mix one file's size with another's bytes.
        const onDisk = Math.max(0, fstatSync(fd).size - (off + 8));
        return Math.min(size, onDisk) / (frameBytes * rate);
      }
      // Chunks are word-aligned; an odd size carries a pad byte the walk has to step over.
      off += 8 + size + (size % 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null)
      try {
        closeSync(fd);
      } catch {
        /* already gone */
      }
  }
}
