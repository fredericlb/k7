// native.test.ts — the Rust measure answers what envelope.ts answers: every array bit for bit, every sidecar byte for byte.
// A reader would get wrong which build runs: WebAssembly always, the addon too when rust/node is built (scripts/buildAddon.mjs in packages/k7x).

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rustSourceHash } from "../scripts/rustSources.mjs";
import { analyseFile } from "./analyse.ts";
import { monoFromInterleaved } from "./decode.ts";
import {
  buildEnvelope,
  envelopeFrom,
  followers,
  type Measured,
  measureMono,
} from "./envelope.ts";
import { measureKind, openMeasure } from "./native.ts";
import { serialiseSidecar } from "./sidecar.ts";
import { SOURCES } from "./waveformWasm.generated.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ADDON = join(ROOT, "packages/k7x/rust/target/release/k7x.node");

/** A seeded generator, so every run measures the same signal. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Signal {
  name: string;
  rate: number;
  channels: number;
  frames: number;
  sample: (frame: number, channel: number) => number;
  chunk: number;
}

const noise = rng(7);
const SIGNALS: Signal[] = [
  {
    name: "empty",
    rate: 48000,
    channels: 2,
    frames: 0,
    sample: () => 0,
    chunk: 4096,
  },
  {
    name: "one sample",
    rate: 44100,
    channels: 1,
    frames: 1,
    sample: () => 0.5,
    chunk: 4096,
  },
  {
    name: "a bucket less one",
    rate: 48000,
    channels: 2,
    frames: 255,
    sample: (f) => Math.sin(f / 3),
    chunk: 100,
  },
  {
    name: "a bucket and one",
    rate: 48000,
    channels: 2,
    frames: 257,
    sample: (f, c) => (c ? -1 : 1) * Math.sin(f / 7),
    chunk: 64,
  },
  {
    name: "noise, odd chunks",
    rate: 44100,
    channels: 2,
    frames: 90_001,
    sample: () => noise() * 2 - 1,
    chunk: 3333,
  },
  {
    name: "six channels, only two summed",
    rate: 48000,
    channels: 6,
    frames: 20_000,
    sample: (f, c) => Math.sin((f * (c + 1)) / 50),
    chunk: 5000,
  },
  {
    name: "two tones for the bands",
    rate: 22050,
    channels: 1,
    frames: 60_000,
    sample: (f) => 0.5 * Math.sin(f * 0.01) + 0.3 * Math.sin(f * 1.3),
    chunk: 8192,
  },
  {
    name: "past the bucket cap",
    rate: 48000,
    channels: 1,
    frames: 8192 * 256 + 4097,
    sample: (f) => ((f * 2654435761) % 1000) / 1000 - 0.5,
    chunk: 65536,
  },
  {
    name: "a click track at 120",
    rate: 48000,
    channels: 2,
    frames: 48000 * 40,
    sample: (f) =>
      f % 24000 < 200 ? 0.9 * Math.sin(f) : 0.01 * Math.sin(f / 40),
    chunk: 48000,
  },
];

/** The signal as the decoder hands it over: interleaved float32 chunks. */
function chunks(s: Signal): Float32Array[] {
  const out: Float32Array[] = [];
  for (let at = 0; at < s.frames; at += s.chunk) {
    const n = Math.min(s.chunk, s.frames - at);
    const block = new Float32Array(n * s.channels);
    for (let f = 0; f < n; f++)
      for (let c = 0; c < s.channels; c++)
        block[f * s.channels + c] = s.sample(at + f, c);
    out.push(block);
  }
  return out;
}

function sameBits(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function expectSame(got: Measured, want: Measured): void {
  for (const k of ["peak", "rms", "low", "mid", "high", "tempo"] as const)
    expect(sameBits(got[k], want[k]), k).toBe(true);
}

const builds = [
  { label: "WebAssembly", addon: false },
  ...(existsSync(ADDON) ? [{ label: "the addon", addon: true }] : []),
];

afterEach(() => {
  delete process.env.K7X_ADDON;
  delete process.env.STUDIO_WAVEFORM;
});

describe("the Rust measure", () => {
  it("is built from the Rust sources as they are", () => {
    expect(
      rustSourceHash(),
      "re-run npm run build:wasm -w @studio/audio-analysis",
    ).toBe(SOURCES);
  });

  for (const build of builds)
    describe(`through ${build.label}`, () => {
      it.each(SIGNALS.map((s) => [s.name, s]))("%s", (_, s) => {
        if (build.addon) process.env.K7X_ADDON = ADDON;
        const parts = chunks(s);
        const mono = parts.map((p) =>
          monoFromInterleaved(p, s.channels, p.length / s.channels),
        );
        const facts = {
          sampleRate: s.rate,
          channels: s.channels,
          frames: s.frames,
        };
        const want = buildEnvelope({ ...facts, mono }, "fp", 2);

        const native = openMeasure();
        expect(native).not.toBeNull();
        if (!native) return;
        expect(measureKind()).toBe(build.addon ? "addon" : "wasm");
        for (const p of parts) native.push(p, s.channels);
        const { aLow, aHigh } = followers(s.rate);
        const measured = native.measure(aLow, aHigh);
        expectSame(measured, measureMono(mono, s.frames, s.rate));
        const got = envelopeFrom(measured, facts, "fp", 2, native.correlations);
        native.close();
        expect(serialiseSidecar(got)).toBe(serialiseSidecar(want));
        if (s.name.startsWith("a click track"))
          expect(got.bpm).toBeCloseTo(120, 0);
      });
    });

  const ffmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  const files = [
    "demos/rack-demo.k7/samples/hat.wav",
    "demos/node-demo.k7/clips/kick.wav",
  ].filter((f) => existsSync(join(ROOT, f)));

  describe.runIf(ffmpeg && files.length > 0)(
    "on real files, decoded by ffmpeg",
    () => {
      it.each(files)("%s writes the same sidecar either way", async (rel) => {
        const dir = mkdtempSync(join(tmpdir(), "waveform-"));
        const a = join(dir, "js.wav");
        const b = join(dir, "rust.wav");
        copyFileSync(join(ROOT, rel), a);
        copyFileSync(join(ROOT, rel), b);
        process.env.STUDIO_WAVEFORM = "js";
        await analyseFile(a);
        delete process.env.STUDIO_WAVEFORM;
        await analyseFile(b);
        expect(measureKind()).not.toBe("none");
        expect(readFileSync(`${b}.cache`, "utf8")).toBe(
          readFileSync(`${a}.cache`, "utf8"),
        );
      });
    },
  );
});
