// platterBench.ts — what the platter's benches share, and not a bench itself: a wav to drive it
// with, the smallest document that plays one, the broadcast frames coming back, and the FFT that
// reads a frequency out of them.
//
// It exists because `turntable.ts` and `keylock.ts` ask two different questions of the same rig,
// and a second copy of an FFT is a second place for a windowing bug to hide.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, pluginDoc, trackDoc } from "@studio/engine-protocol/build";
import type WebSocket from "ws";
import { wavFile } from "./wav.ts";

/** The platter every bench here drives. */
export const PLUGIN = "deckA:platter";

/** One mono 16-bit wav in a scratch folder, and where it landed. */
export function writeWav(pcm: Int16Array, rate: number, tag: string): string {
  // STEREO, both sides the same: what a record off the médiathèque is, and the format the deck maps rather than decodes.
  const stereo = new Int16Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) stereo[2 * i] = stereo[2 * i + 1] = pcm[i];
  const bytes = Buffer.from(stereo.buffer, stereo.byteOffset, stereo.byteLength);
  const file = join(
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), `m9-${tag}-`)),
    `${tag}.wav`,
  );
  writeFileSync(file, wavFile(bytes, rate, 2, 16));
  return file;
}

/** The dominant frequency of a window, parabolically interpolated. Shorter input is zero-padded. */
export function peakHz(x: Float32Array, rate: number, n = 4096): number {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++)
    re[i] = (x[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1)
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const ang = (-2 * Math.PI * k) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  let best = 1;
  let bm = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > bm) [bm, best] = [m, k];
  }
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  const l = mag(best - 1);
  const c = Math.sqrt(bm);
  const r = mag(best + 1);
  return ((best + (0.5 * (l - r)) / (l - 2 * c + r || 1)) * rate) / n;
}

/** One track, one platter, nothing else — the smallest document that plays a record without a clip. */
export function platterDoc(source: string, rate: number, params = {}, name = "turntable") {
  const platter = pluginDoc({
    id: PLUGIN,
    type: "studio_turntable",
    name: "platter",
    deckFile: source,
    role: "instrument",
    params: { Rate: 1, Seek: 0, Gain: 1, ...params },
  });
  return emptyDoc({ name, sampleRate: rate, tracks: [trackDoc("deckA", { plugins: [platter] })] });
}

// The stream at the DEVICE's rate brought to the rate the analyses count in, linearly, phase carried across chunks (docs/audit-stabilite.md).
export function streamResampler(to: number): (mono: Float32Array, from: number) => Float32Array {
  let pos = 0; // where the next output sample falls, in input samples from the start of the next chunk
  let carry = 0; // the previous chunk's last sample, for a position between the two chunks
  return (mono, from) => {
    if (from === to || mono.length === 0) return mono;
    const step = from / to;
    const out: number[] = [];
    while (pos < mono.length - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i < 0 ? carry : mono[i];
      const b = mono[i + 1];
      out.push(a + (b - a) * frac);
      pos += step;
    }
    pos -= mono.length;
    carry = mono[mono.length - 1];
    return Float32Array.from(out);
  };
}

/** The master stream (`LSTR`) one mono chunk per frame; answers the LEAST-delayed origin of sample 0 (docs/turntable.md). */
export function onBroadcast(
  ws: WebSocket,
  rate: number,
  take: (mono: Float32Array) => void,
): () => number {
  let seen = 0;
  let origin = Number.POSITIVE_INFINITY;
  const resample = streamResampler(rate);
  ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    const buf =
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4c535452) return;
    const channels = dv.getUint8(5);
    const streamRate = dv.getUint32(8, true);
    const frames = dv.getUint32(12, true);
    const all = new Float32Array(buf, 32, frames * channels);
    const raw = new Float32Array(frames);
    for (let i = 0; i < frames; i++) raw[i] = all[i * channels];
    // At the rate the caller counts in, whatever rate the device runs at.
    const mono = resample(raw, streamRate);
    seen += mono.length;
    // This chunk ENDS at `seen`, so it was produced no later than now — keep the tightest guess.
    origin = Math.min(origin, performance.now() - (seen / rate) * 1000);
    take(mono);
  });
  return () => origin;
}
