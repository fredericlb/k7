// sfz-to-rack.ts — turn an SFZ drum kit into a RACK kit: one sample per piece, rendered through the engine's own
// SFZ player at one velocity, written into a library's samples/ with a rack preset that maps each one to its note.
// The one thing a reader would get wrong: a piece is RENDERED, not copied — a kit plays several mics per hit, and
// the sample is what the player sounds for that hit, mics mixed. See packages/song/docs/racks.md.
//
//   npx tsx engine/k7-runtime/scripts/sfz-to-rack.ts --sfz <kit.sfz> --library <library root> --folder <name>
//     --preset "<name>" --pieces "Kick=36,Snare=38,Crash=49:6" [--velocity 100] [--seconds 2] [--name k7]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderProject } from "../../../packages/file-service/src/render.ts";
import { readWav, wavFile } from "./wav.ts";

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const v = at >= 0 ? process.argv[at + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};

const sfz = arg("sfz");
const library = arg("library");
const folder = arg("folder");
const presetName = arg("preset");
const velocity = Number(arg("velocity", "100")) / 127;
const defaultSeconds = Number(arg("seconds", "2"));
// `Name=note` or `Name=note:seconds`, a cymbal wanting longer than a drum to ring out.
const pieces = arg("pieces")
  .split(",")
  .map((p) => {
    const [name, spec] = p.split("=");
    const [note, seconds] = spec.split(":");
    return { name: name.trim(), note: Number(note), seconds: Number(seconds ?? defaultSeconds) };
  });

const RATE = 48000;
// Below this a tail is silence: -66 dBFS, under a 16-bit dither.
const FLOOR = 10 ** (-66 / 20);
const FADE_S = 0.01;

/** One note through the SFZ player, rendered offline; the 24-bit stereo wav the engine writes. */
async function renderPiece(note: number, seconds: number): Promise<Buffer> {
  const beats = (seconds * 120) / 60;
  const doc = {
    name: "sfz-to-rack",
    tempo: 120,
    sampleRate: RATE,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [
      {
        id: "t1",
        name: "kit",
        clips: [
          {
            id: "c1",
            type: "midi",
            name: "hit",
            start: 0,
            length: beats,
            notes: [{ time: 0, duration: 0.25, key: note, vel: velocity, channel: 1 }],
          },
        ],
        plugins: [{ id: "t1:kit", type: "studio_sfz", name: "SFZ Player", role: "instrument", sfzFile: sfz }],
      },
    ],
  };
  const out = await renderProject(doc as never);
  return readFileSync(out.files[0]);
}

/** The data chunk of a 24-bit PCM wav, and its channel count. */
function pcm24(wav: Buffer): { data: Buffer; channels: number } {
  const w = readWav(wav);
  if (w.bits !== 24) throw new Error("expected the engine's 24-bit render");
  return { data: w.data, channels: w.channels };
}

/** The render with its silent tail cut and a short fade on what is left. */
function trimmed(wav: Buffer): Buffer {
  const { data, channels } = pcm24(wav);
  const frame = 3 * channels;
  const frames = Math.floor(data.length / frame);
  const at = (f: number, c: number) => data.readIntLE(f * frame + c * 3, 3) / 8388608;
  let last = 0;
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels; c++) if (Math.abs(at(f, c)) > FLOOR) last = f;
  const keep = Math.min(frames, last + 1 + Math.round(FADE_S * RATE));
  const out = Buffer.alloc(keep * frame);
  const fade = Math.round(FADE_S * RATE);
  for (let f = 0; f < keep; f++) {
    const g = f > keep - fade ? (keep - f) / fade : 1;
    for (let c = 0; c < channels; c++)
      out.writeIntLE(Math.round(Math.max(-1, Math.min(1, at(f, c) * g)) * 8388607), f * frame + c * 3, 3);
  }
  return wavFile(out, RATE, channels, 24);
}

async function main() {
  const libraryName = arg("name", "k7-core");
  const samples = join(library, "samples", folder);
  mkdirSync(samples, { recursive: true });
  // `engine: samples`: the rack's taps are its sampler engine's, its default being an SFZ kit (packages/song/docs/racks.md).
  const lines = ["# preset for @k7-core/instruments/k7-rack", "engine: samples", "rack:"];
  for (const p of pieces) {
    const wav = trimmed(await renderPiece(p.note, p.seconds));
    writeFileSync(join(samples, `${p.name}.wav`), wav);
    lines.push(`  ${p.name}: { note: ${p.note}, sample: "@${libraryName}/${folder}/${p.name}.wav" }`);
    console.log(`${p.name.padEnd(12)} note ${p.note}  ${(wav.length / 1024).toFixed(0)} KB`);
  }
  const presets = join(library, "presets", "k7-core", "instruments", "k7-rack");
  mkdirSync(presets, { recursive: true });
  writeFileSync(join(presets, `${presetName}.yaml`), `${lines.join("\n")}\n`);
  console.log(`rack preset "${presetName}" → ${presets}`);
}

void main();
