// platterBench.ts — what the platter's benches share, and not a bench itself: a wav to drive it
// with, the smallest document that plays one, the broadcast frames coming back, and the FFT that
// reads a frequency out of them.
//
// It exists because `turntable.ts` and `keylock.ts` ask two different questions of the same rig,
// and a second copy of an FFT is a second place for a windowing bug to hide.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type WebSocket from "ws";

/** The platter every bench here drives. */
export const PLUGIN = "deckA:platter";

/** One mono 16-bit wav in a scratch folder, and where it landed. */
export function writeWav(pcm: Int16Array, rate: number, tag: string): string {
  const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + bytes.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(bytes.length, 40);
  const file = join(
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), `m9-${tag}-`)),
    `${tag}.wav`,
  );
  writeFileSync(file, Buffer.concat([h, bytes]));
  return file;
}

/** The same file, named the way the ENGINE will have to open it. Identity everywhere but WSL. */
export function asEngineSees(path: string): string {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : path;
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
export function platterDoc(source: string, rate: number, params = {}) {
  return {
    name: "turntable",
    tempo: 120,
    sampleRate: rate,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    masterVolume: 0,
    masterPlugins: [],
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    markers: [],
    strudel: false,
    tracks: [
      {
        id: "deckA",
        name: "deckA",
        role: "regular",
        contentType: "audio",
        group: "",
        generated: false,
        color: "",
        mute: false,
        solo: false,
        disabled: false,
        inputChannels: [],
        outputChannels: [],
        monitor: "auto",
        inputGain: 0,
        clips: [],
        plugins: [
          {
            id: PLUGIN,
            type: "studio_turntable",
            name: "platter",
            path: "",
            deckFile: asEngineSees(source),
            presetSave: "",
            role: "instrument",
            enabled: true,
            params: { Rate: 1, Seek: 0, Gain: 1, ...params },
          },
        ],
        sends: [],
        automation: [],
      },
    ],
  };
}

/** The master stream, one mono chunk per frame — `LSTR`, and anything else is not for us.
 *
 * Returns the least-delayed estimate of when sample 0 was produced, which is how a sample index
 * becomes a wall clock. It converges on the MINIMUM rather than the mean because the tap carries its
 * own buffering — the same reason `@studio/engine-browser/playhead-clock` does. */
export function onBroadcast(
  ws: WebSocket,
  rate: number,
  take: (mono: Float32Array) => void,
): () => number {
  let seen = 0;
  let origin = Number.POSITIVE_INFINITY;
  ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    const buf =
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4c535452) return;
    const channels = dv.getUint8(5);
    const frames = dv.getUint32(12, true);
    const all = new Float32Array(buf, 32, frames * channels);
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = all[i * channels];
    seen += frames;
    // This chunk ENDS at `seen`, so it was produced no later than now — keep the tightest guess.
    origin = Math.min(origin, performance.now() - (seen / rate) * 1000);
    take(mono);
  });
  return () => origin;
}
