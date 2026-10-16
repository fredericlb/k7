// nam-rate.ts — does a NAM model sound as trained when the engine runs at ANOTHER rate? Offline,
// no engine needed: the same sawtooth through the same model, rendered at the model's own rate and
// at another, and the amp's harmonic profile compared between the two.
//
//   npx tsx engine/k7-runtime/scripts/nam-rate.ts <model.nam> [otherRate=44100]
//
// A model is a recurrent filter clocked per SAMPLE, so run at the wrong rate it is another amp: its
// harmonics come out at different levels. Resampled to its own rate they should match to within the
// converter's error (docs/namPlugin.md). What it cannot say is how it SOUNDS — only that it matches.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProject } from "../../../packages/file-service/src/render.ts";

export const F0 = 110;
const SECONDS = 3;
export const HARMONICS = 60;

/** A band-limited sawtooth at `rate`, mono 16-bit, quiet enough to leave the amp room. */
export function sawtooth(rate: number): string {
  const n = rate * SECONDS;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 1; k * F0 < rate / 2; k++)
      v += Math.sin((2 * Math.PI * k * F0 * i) / rate) / k;
    pcm.writeInt16LE(Math.round(v * 0.12 * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  const file = join(mkdtempSync(join(tmpdir(), "m9-nam-")), `saw-${rate}.wav`);
  writeFileSync(file, Buffer.concat([h, pcm]));
  return file;
}

/** The first channel of a PCM or float wav, as floats, and its rate. */
export function readWav(file: string): { rate: number; x: Float32Array } {
  const b = readFileSync(file);
  let at = 12;
  let fmt = { format: 1, channels: 1, rate: 0, bits: 16 };
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
    if (id === "data") {
      const step = (fmt.bits / 8) * fmt.channels;
      const n = Math.floor(size / step);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const o = body + i * step;
        x[i] =
          fmt.bits === 32 && fmt.format === 3
            ? b.readFloatLE(o)
            : fmt.bits === 24
              ? b.readIntLE(o, 3) / 8388608
              : fmt.bits === 32
                ? b.readInt32LE(o) / 2147483648
                : b.readInt16LE(o) / 32768;
      }
      return { rate: fmt.rate, x };
    }
    at = body + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

/** Each harmonic's level in dB relative to the fundamental, by Goertzel over the steady middle second. */
export function profile({ rate, x }: { rate: number; x: Float32Array }): number[] {
  const from = Math.floor(rate * 1);
  const n = Math.floor(rate * 1);
  const mag = (f: number) => {
    const w = (2 * Math.PI * f) / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const s0 = x[from + i] * hann + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
  };
  const fund = mag(F0);
  const out: number[] = [];
  for (let k = 1; k <= HARMONICS; k++)
    out.push(20 * Math.log10(mag(k * F0) / fund + 1e-12));
  return out;
}

/** The sawtooth through one NAM plugin at `rate`, as its harmonic profile; `extra` joins the plugin's fields. */
export async function renderAt(
  model: string,
  rate: number,
  extra: Record<string, unknown> = {},
): Promise<number[]> {
  const doc = {
    name: "nam-rate",
    tempo: 120,
    sampleRate: rate,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [
      {
        id: "gtr",
        name: "gtr",
        clips: [
          {
            id: "saw",
            type: "audio",
            name: "saw",
            // The source at the SAME rate as the render, so the only rate question left is the model's.
            source: sawtooth(rate),
            start: 0,
            length: SECONDS * 2,
            offset: 0,
          },
        ],
        plugins: [
          {
            id: "gtr:amp",
            type: "studio_nam",
            name: "amp",
            role: "audioFX",
            namFile: model,
            params: {},
            ...extra,
          },
        ],
      },
    ],
  };
  const out = await renderProject(doc);
  return profile(readWav(out.files[0]));
}

async function main() {
  const model = process.argv[2];
  const OTHER = Number(process.argv[3] ?? 44100);
  if (!model) {
    console.error("usage: nam-rate.ts <model.nam> [otherRate]");
    process.exit(2);
  }
  const trained = Number(
    JSON.parse(readFileSync(model, "utf8")).sample_rate ?? 48000,
  );
  const at = await renderAt(model, trained);
  const other = await renderAt(model, OTHER);
  // The harmonics that matter to an amp's colour: every one the model puts within 40 dB of the fundamental.
  const diffs = at
    .map((db, i) => ({ k: i + 1, a: db, b: other[i] }))
    .filter((h) => h.a > -40);
  const worst = diffs.reduce((m, h) => Math.max(m, Math.abs(h.a - h.b)), 0);
  const mean = diffs.reduce((s, h) => s + Math.abs(h.a - h.b), 0) / diffs.length;
  console.log(`model trained at ${trained} Hz, compared at ${OTHER} Hz, ${diffs.length} harmonics`);
  for (const h of diffs.slice(0, 12))
    console.log(`  h${String(h.k).padEnd(3)} ${h.a.toFixed(1).padStart(6)} dB  vs ${h.b.toFixed(1).padStart(6)} dB`);
  console.log(`mean |Δ| ${mean.toFixed(2)} dB   worst ${worst.toFixed(2)} dB`);
  // A dB on average is audible on an amp; the converter alone stays well under it.
  const ok = mean < 1;
  console.log(ok ? "OK — the model sounds as trained" : "ECHEC — another amp at this rate");
  process.exit(ok ? 0 : 1);
}

// Run as a script only: nam-ir.ts imports the rig above and asks it another question.
if (process.argv[1]?.endsWith("nam-rate.ts")) void main();
