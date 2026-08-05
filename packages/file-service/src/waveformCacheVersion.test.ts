// The sidecar gained `transients` + `sensitivity` in v2, and `bpm` in v3. The trap this pins:
// an older sidecar carries a MATCHING fingerprint — the audio has not changed — so without a
// version gate every freshness check passes and the file never gets the new field at all.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cachePath,
  DEFAULT_TRANSIENT_SENSITIVITY,
  fileFingerprint,
  staleWaveformSources,
  storedSensitivity,
} from "./waveformCache.ts";

let dir: string;
let audio: string;

/** A sidecar that is valid in every way except the fields under test. */
function sidecar(extra: Record<string, unknown>): void {
  writeFileSync(
    cachePath(audio),
    JSON.stringify({
      fingerprint: fileFingerprint(audio),
      sampleRate: 48000,
      channels: 1,
      frames: 4800,
      seconds: 0.1,
      peak: [0, 1, 0],
      rms: [0, 0.5, 0],
      ...extra,
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-wfver-"));
  audio = join(dir, "kick.wav");
  writeFileSync(audio, Buffer.from("RIFF....WAVEfmt fake payload"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the sidecar version gate", () => {
  it("treats every superseded version as stale, fingerprint or no fingerprint", () => {
    // v2 is the case that matters today: it has transients but no bpm, and a matching
    // fingerprint, so nothing else would ever ask for it to be rebuilt.
    for (const v of [1, 2]) {
      sidecar({ v, transients: [0.05], sensitivity: 2 });
      expect(staleWaveformSources([audio]), `v${v}`).toEqual([audio]);
    }
  });

  it("treats a sidecar with no version at all as v1, and so as stale", () => {
    sidecar({});
    expect(staleWaveformSources([audio])).toEqual([audio]);
  });

  it("accepts the current version", () => {
    sidecar({ v: 3, transients: [0.05], sensitivity: 2, bpm: 120 });
    expect(staleWaveformSources([audio])).toEqual([]);
  });

  it("still rebuilds a current sidecar whose fingerprint no longer matches", () => {
    sidecar({ v: 3, transients: [], sensitivity: 2, bpm: 0 });
    writeFileSync(audio, Buffer.from("RIFF....WAVEfmt DIFFERENT payload"));
    expect(staleWaveformSources([audio])).toEqual([audio]);
  });
});

describe("storedSensitivity", () => {
  it("reads the threshold a sidecar was built with", () => {
    sidecar({ v: 3, transients: [], sensitivity: 3.5, bpm: 0 });
    expect(storedSensitivity(audio)).toBe(3.5);
  });

  it("reads it from a sidecar whose fingerprint has gone STALE", () => {
    // The whole point: re-recording a take must not silently reset a tuned threshold.
    sidecar({ v: 3, transients: [], sensitivity: 3.5, bpm: 0 });
    writeFileSync(audio, Buffer.from("RIFF....WAVEfmt DIFFERENT payload"));
    expect(storedSensitivity(audio)).toBe(3.5);
  });

  it("is null when there is nothing to read", () => {
    expect(storedSensitivity(audio)).toBe(null);
    sidecar({ v: 1 }); // v1 carries no sensitivity
    expect(storedSensitivity(audio)).toBe(null);
  });

  it("has a default that matches the engine's", () => {
    // kDefaultTransientSensitivity in engine/moteur/engine/EngineHost.h.
    expect(DEFAULT_TRANSIENT_SENSITIVITY).toBe(2);
  });
});
