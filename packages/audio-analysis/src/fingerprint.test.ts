// fingerprint.test.ts — the 32-bit-halves FNV-1a/64 gives the fingerprint the BigInt one did, byte for byte:
// a different answer would mark every sidecar on every disk stale at once.

import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileFingerprint } from "./fingerprint.ts";

/** The BigInt implementation the fingerprint shipped with, kept as the reference. */
function reference(data: Buffer): string {
  const PRIME = 0x100000001b3n;
  const MASK = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  const step = (b: number) => {
    h = ((h ^ BigInt(b)) * PRIME) & MASK;
  };
  let s = data.length;
  for (let k = 0; k < 8; k++) {
    step(s & 0xff);
    s = Math.floor(s / 256);
  }
  const head = data.subarray(0, Math.min(65536, data.length));
  for (const b of head) step(b);
  const tail = data.subarray(data.length > 65536 ? data.length - 65536 : 0);
  for (const b of tail) step(b);
  return `${data.length}-${h.toString(16).padStart(16, "0")}`;
}

describe("fileFingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "fingerprint-"));
  const cases: [string, Buffer][] = [
    ["empty", Buffer.alloc(0)],
    ["one byte", Buffer.from([0xab])],
    ["all 0xff", Buffer.alloc(70000, 0xff)],
    ...[100, 65535, 65536, 65537, 131072, 131073, 300000].map(
      (n): [string, Buffer] => [`${n} random bytes`, randomBytes(n)],
    ),
  ];
  for (const [name, data] of cases)
    it(`matches the BigInt reference: ${name}`, () => {
      const file = join(dir, `${name.replace(/\W+/g, "-")}.bin`);
      writeFileSync(file, data);
      expect(fileFingerprint(file)).toBe(reference(data));
    });
});
