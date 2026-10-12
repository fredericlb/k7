// Two asks for one file are ONE decode. A timeline drawing several lanes off the same take asks
// for its envelope several times at once, and each ask used to spawn its own engine over the same
// audio — on a 33 MB file that is seconds of CPU per copy, which is what a click felt like.
//
// The decode is mocked at `analyseFile`, not with a stand-in engine: what is under test is how many
// times this module starts one, and nothing about what it does. See docs/waveformCache.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** How many decodes were asked for, and the ones held open so two asks can overlap. */
let spawns: string[] = [];
let held: (() => void)[] = [];
let holding = false;

vi.mock("@studio/audio-analysis/analyse", () => ({
  analyseFile: (source: string) => {
    spawns.push(source);
    return new Promise((resolve) => {
      const finish = () => resolve(writeSidecar());
      if (holding) held.push(finish);
      else finish();
    });
  },
}));

const { CACHE_VERSION } = await import("@studio/audio-analysis/sidecar");
const { ensureFileEnvelope, cachePath, fileFingerprint, invalidateEnvelope } =
  await import("./waveformCache.ts");

let dir: string;
let audio: string;

/** The sidecar a real analysis writes, minus everything this test does not read; returned as its envelope. */
function writeSidecar(): unknown {
  const env = {
    // `v`, not `version`, and the CURRENT one: an older sidecar is refused as stale by design.
    v: CACHE_VERSION,
    fingerprint: fileFingerprint(audio),
    sampleRate: 48000,
    channels: 1,
    frames: 4800,
    seconds: 0.1,
    peak: [0, 1, 0],
    rms: [0, 0.5, 0],
    transients: [],
    sensitivity: 1,
  };
  writeFileSync(cachePath(audio), JSON.stringify(env));
  return env;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-inflight-"));
  audio = join(dir, "take.wav");
  writeFileSync(audio, Buffer.alloc(4096, 7));
  spawns = [];
  held = [];
  holding = false;
  invalidateEnvelope();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  invalidateEnvelope();
});

describe("ensureFileEnvelope", () => {
  it("decodes once for asks that overlap", async () => {
    // The decode is held open, so the second ask lands while the first is still running.
    holding = true;
    const first = ensureFileEnvelope(audio, "engine");
    const second = ensureFileEnvelope(audio, "engine");
    // Counted BEFORE anything is let go: the second ask must not have started a decode at all.
    expect(spawns).toHaveLength(1);
    for (const finish of held) finish();
    const [a, b] = await Promise.all([first, second]);
    expect(spawns).toHaveLength(1);
    // …and both callers get the same answer, since there is only one.
    expect(a).toEqual(b);
  });

  it("decodes again after a failure rather than joining a dead one", async () => {
    // A joined promise that rejected would make every later ask fail with the first one's error.
    await ensureFileEnvelope(audio, "engine");
    invalidateEnvelope();
    rmSync(cachePath(audio), { force: true });
    await ensureFileEnvelope(audio, "engine");
    expect(spawns).toHaveLength(2);
  });
});
