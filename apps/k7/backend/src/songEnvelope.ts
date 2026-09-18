// songEnvelope.ts — the shape of a reference track: ffmpeg decodes it to raw mono floats and this
// buckets them into per-interval RMS, which is what the waveform canvas draws.
// Measured ONCE and kept in Grist — a rehearsal laptop must not decode forty megabytes to open a
// song page. See ../../docs/audio.md.

import { spawn } from "node:child_process";
import type { SongEnvelope } from "@k7/shared";

/** How many buckets a stored shape gets at most — see ../../docs/audio.md for what it costs. */
export const MAX_BUCKETS = 800;

/** A level curve needs no bandwidth: 8 kHz mono decodes fast and measures the same shape. */
const RATE = 8000;

/** ffmpeg's arguments for decoding `file` to raw mono floats on stdout. */
export function decodeArgs(file: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    file,
    "-f",
    "f32le",
    "-acodec",
    "pcm_f32le",
    "-ar",
    String(RATE),
    "-ac",
    "1",
    "-",
  ];
}

/** Per-bucket RMS of `samples`, normalised so the loudest bucket fills the canvas. */
export function bucketsOf(samples: Float32Array, perBucket: number): number[] {
  const out: number[] = [];
  for (let at = 0; at < samples.length; at += perBucket) {
    const end = Math.min(at + perBucket, samples.length);
    let sum = 0;
    for (let i = at; i < end; i++) sum += samples[i] * samples[i];
    out.push(Math.sqrt(sum / Math.max(1, end - at)));
  }
  const peak = out.reduce((m, v) => (v > m ? v : m), 0);
  // Normalised like the recorder's, so a quiet track still draws a readable shape.
  if (peak <= 0) return out;
  // Three decimals: more precision is below one pixel of the panel and doubles what is stored.
  return out.map((v) => Math.round((v / peak) * 1000) / 1000);
}

/** Decode `file` and measure it. Rejects with what ffmpeg printed, like every other spawn here. */
export function envelopeOf(file: string): Promise<SongEnvelope> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", decodeArgs(file));
    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.stderr.on("data", (d) => {
      err += d.toString();
    });
    ff.on("error", (e) =>
      reject(new Error(`ffmpeg could not start: ${e.message}`)),
    );
    ff.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg exited with ${code}: ${err.trim().slice(0, 300)}`),
        );
      const raw = Buffer.concat(chunks);
      // A trailing partial float would read as noise; whole samples only.
      const count = Math.floor(raw.length / 4);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = raw.readFloatLE(i * 4);
      // The bucket follows the LENGTH: a fixed interval gives a long song thousands of them.
      const perBucket = Math.max(1, Math.ceil(count / MAX_BUCKETS));
      resolve({
        intervalMs: Math.round((perBucket / RATE) * 1000),
        samples: bucketsOf(samples, perBucket),
        seconds: count / RATE,
      });
    });
  });
}
