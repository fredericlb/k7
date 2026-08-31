// sidecar.test.ts — the file two producers write: it must round-trip, and it must refuse a
// version older than the fields the readers now assume.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cachePath,
  readSidecar,
  serialiseSidecar,
  storedSensitivity,
  writeSidecar,
} from "./sidecar.ts";

const ENV = {
  fingerprint: "12-00000000000000ff",
  sampleRate: 48000,
  channels: 2,
  frames: 96000,
  seconds: 2,
  peak: [0.5, 0.25],
  rms: [0.1, 0.05],
  transients: [0.5, 1.5],
  sensitivity: 2,
  bpm: 120,
  low: [0.4, 0.2],
  mid: [0.3, 0.1],
  high: [0.2, 0.05],
};

const scratch = (): string =>
  join(mkdtempSync(join(tmpdir(), "sidecar-")), "a.wav");

describe("the sidecar", () => {
  it("round-trips through the bytes it writes", () => {
    const src = scratch();
    writeFileSync(src, "not really audio");
    writeSidecar(src, ENV);
    expect(readSidecar(src)).toEqual(ENV);
  });

  it("writes the version and the fixed precision engine/moteur writes", () => {
    const s = serialiseSidecar(ENV);
    expect(s.startsWith('{"v":4,"fingerprint":"12-00000000000000ff"')).toBe(
      true,
    );
    expect(s).toContain('"peak":[0.5000,0.2500]');
    expect(s).toContain('"bpm":120.00');
    expect(s).toContain('"transients":[0.500000,1.500000]');
  });

  it("refuses a sidecar older than the fields its readers assume", () => {
    const src = scratch();
    writeFileSync(src, "not really audio");
    writeFileSync(cachePath(src), JSON.stringify({ ...ENV, v: 3 }));
    expect(readSidecar(src)).toBeNull();
  });

  it("reads as no cache when there is none", () => {
    expect(readSidecar(scratch())).toBeNull();
    expect(storedSensitivity(scratch())).toBeNull();
  });

  // Read even from a sidecar gone stale: it is what a rebuild should keep using.
  it("reports the sensitivity of a sidecar whose fingerprint no longer matches", () => {
    const src = scratch();
    writeFileSync(src, "not really audio");
    writeSidecar(src, { ...ENV, sensitivity: 3.5 });
    writeFileSync(src, "different bytes entirely");
    expect(storedSensitivity(src)).toBe(3.5);
  });
});
