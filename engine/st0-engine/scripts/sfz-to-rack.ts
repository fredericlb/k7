// sfz-to-rack.ts — turn an SFZ drum kit into a RACK kit: one sample per piece, rendered through the engine's own
// SFZ player at one velocity, written into a library's samples/ with a rack preset that maps each one to its note.
// The one thing a reader would get wrong: a piece is RENDERED, not copied — a kit plays several mics per hit, and
// the sample is what the player sounds for that hit, mics mixed. See packages/song/docs/racks.md.
//
//   npx tsx engine/st0-engine/scripts/sfz-to-rack.ts --sfz <kit.sfz> --library <library root> --folder <name>
//     --preset "<name>" --pieces "Kick=36,Snare=38,Crash=49:6" [--velocity 100] [--seconds 2] [--name st0]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderProject } from "../../../packages/file-service/src/render.ts";

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
  let i = 12;
  let channels = 2;
  while (i < wav.length) {
    const id = wav.toString("ascii", i, i + 4);
    const size = wav.readUInt32LE(i + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(i + 10);
      if (wav.readUInt16LE(i + 22) !== 24) throw new Error("expected the engine's 24-bit render");
    }
    if (id === "data") return { data: wav.subarray(i + 8, i + 8 + size), channels };
    i += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
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
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + out.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * frame, 28);
  header.writeUInt16LE(frame, 32);
  header.writeUInt16LE(24, 34);
  header.write("data", 36);
  header.writeUInt32LE(out.length, 40);
  return Buffer.concat([header, out]);
}

async function main() {
  const libraryName = arg("name", "st0");
  const samples = join(library, "samples", folder);
  mkdirSync(samples, { recursive: true });
  // `engine: samples`: the rack's taps are its sampler engine's, its default being an SFZ kit (packages/song/docs/racks.md).
  const lines = ["# preset for @st0/instruments/st0-rack", "engine: samples", "rack:"];
  for (const p of pieces) {
    const wav = trimmed(await renderPiece(p.note, p.seconds));
    writeFileSync(join(samples, `${p.name}.wav`), wav);
    lines.push(`  ${p.name}: { note: ${p.note}, sample: "@${libraryName}/${folder}/${p.name}.wav" }`);
    console.log(`${p.name.padEnd(12)} note ${p.note}  ${(wav.length / 1024).toFixed(0)} KB`);
  }
  const presets = join(library, "presets", "st0", "instruments", "st0-rack");
  mkdirSync(presets, { recursive: true });
  writeFileSync(join(presets, `${presetName}.yaml`), `${lines.join("\n")}\n`);
  console.log(`rack preset "${presetName}" → ${presets}`);
}

void main();
