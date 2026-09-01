// fingerprint.ts — the content fingerprint stamped into a `{file}.cache` sidecar and checked
// on every read. FNV-1a/64 over the file size then the first and last 64 KB, and it MUST stay
// byte-for-byte identical to `fileFingerprint` in engine/st0-engine/engine/Waveform.cpp: the two
// producers of a sidecar have to agree on whether one is stale. See docs/analysis.md.

import { closeSync, openSync, readSync, statSync } from "node:fs";

const HEAD = 65536;
const TAIL = 65536;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

/** `<size>-<16 hex digits>`, cheap enough to recompute on every read of the sidecar. */
export function fileFingerprint(source: string): string {
  const size = statSync(source).size;
  let h = FNV_OFFSET;
  const step = (byte: number): void => {
    h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  };
  // Size as 8 little-endian bytes.
  let s = size;
  for (let k = 0; k < 8; k++) {
    step(s & 0xff);
    s = Math.floor(s / 256);
  }
  const fd = openSync(source, "r");
  try {
    const buf = Buffer.allocUnsafe(Math.min(HEAD, Math.max(0, size)) || 1);
    // Head: [0, min(size, HEAD)).
    const headLen = Math.min(HEAD, size);
    if (headLen > 0) {
      const n = readSync(fd, buf, 0, headLen, 0);
      for (let i = 0; i < n; i++) step(buf[i]);
    }
    // Tail: [max(0, size - TAIL), size).
    const tailStart = size > TAIL ? size - TAIL : 0;
    const tailLen = size - tailStart;
    if (tailLen > 0) {
      const tbuf = tailLen <= buf.length ? buf : Buffer.allocUnsafe(tailLen);
      const n = readSync(fd, tbuf, 0, tailLen, tailStart);
      for (let i = 0; i < n; i++) step(tbuf[i]);
    }
  } finally {
    closeSync(fd);
  }
  return `${size}-${h.toString(16).padStart(16, "0")}`;
}
