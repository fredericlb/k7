// fingerprint.ts — the content fingerprint stamped into a `{file}.cache` sidecar and checked
// on every read. FNV-1a/64 over the file size then the first and last 64 KB. Changing it marks
// every sidecar on every disk stale at once, so it changes only with CACHE_VERSION.
// See docs/analysis.md.

import { closeSync, openSync, readSync, statSync } from "node:fs";

const HEAD = 65536;
const TAIL = 65536;
// FNV-1a/64 in two 32-bit halves: a BigInt per byte allocated 128 KB of them per read, 7x slower on a phone.
const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
const PRIME_LO = 0x1b3; // the prime is 2^40 + 0x1b3

/** `<size>-<16 hex digits>`, cheap enough to recompute on every read of the sidecar. */
export function fileFingerprint(source: string): string {
  const size = statSync(source).size;
  let hi = OFFSET_HI;
  let lo = OFFSET_LO;
  const step = (byte: number): void => {
    lo = (lo ^ byte) >>> 0;
    // (hi·2^32 + lo)·(2^40 + 0x1b3) mod 2^64: lo·0x1b3 carries into hi, lo·2^40 lands in hi shifted by 8.
    const low = lo * PRIME_LO;
    const carry = Math.floor(low / 0x100000000);
    hi = (Math.imul(hi, PRIME_LO) + (lo << 8) + carry) >>> 0;
    lo = low >>> 0;
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
  return `${size}-${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}
