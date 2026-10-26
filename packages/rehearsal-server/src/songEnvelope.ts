// songEnvelope.ts — the shape of a reference track. pl8 decodes and measures it (it already
// holds the bytes and a decoder); this shapes pl8's finer buckets down to what the waveform
// canvas needs. Measured ONCE, by the library, which keeps it beside the file — a rehearsal laptop
// must not re-decode a song to open its page. See ../docs/audio.md.

import type { SongEnvelope } from "@studio/rehearsal-shared";
import { getFileEnvelope } from "./mediatek.ts";

/** How many buckets a stored shape gets at most — see ../docs/audio.md for what it costs. */
export const MAX_BUCKETS = 800;

/** Group pl8's per-bucket RMS into at most MAX_BUCKETS, RMS-of-RMS so a loud group still reads loud. */
export function downsample(rms: number[], perBucket: number): number[] {
  const out: number[] = [];
  for (let at = 0; at < rms.length; at += perBucket) {
    const end = Math.min(at + perBucket, rms.length);
    let sum = 0;
    for (let i = at; i < end; i++) sum += rms[i] * rms[i];
    out.push(Math.sqrt(sum / Math.max(1, end - at)));
  }
  return out;
}

/** Group by MAX, as the waveform's own columns do: averaging would flatten a kick into its neighbours. */
export function downsampleMax(values: number[], perBucket: number): number[] {
  const out: number[] = [];
  for (let at = 0; at < values.length; at += perBucket) {
    let m = 0;
    for (let i = at; i < Math.min(at + perBucket, values.length); i++)
      if (values[i] > m) m = values[i];
    out.push(m);
  }
  return out;
}

/** Normalised so the loudest bucket fills the canvas, or by `by` when given. Three decimals: more is below one pixel. */
export function normalise(values: number[], by?: number): number[] {
  const peak = by ?? values.reduce((m, v) => (v > m ? v : m), 0);
  if (peak <= 0) return values;
  return values.map((v) => Math.round((v / peak) * 1000) / 1000);
}

/** Whether a stored shape is one the spectrum waveform can draw tall, rather than an RMS-only one to measure again. */
export const hasPeak = (e: { peak?: number[] } | null | undefined): boolean =>
  !!e?.peak?.length;

/** pl8's measurement of `path`, shaped into what the waveform canvas draws. */
export async function envelopeOf(path: string): Promise<SongEnvelope> {
  const env = await getFileEnvelope(path);
  const perBucket = Math.max(1, Math.ceil(env.rms.length / MAX_BUCKETS));
  // Derived from what pl8 reports rather than its own bucketing constant, so this stays
  // correct even if pl8's own resolution changes.
  const bucketSeconds =
    env.rms.length > 0 ? (env.seconds / env.rms.length) * perBucket : 0;
  const same = (a?: number[]) =>
    a?.length === env.rms.length ? downsampleMax(a, perBucket) : undefined;
  const peak = same(env.peak);
  const top = peak?.reduce((m, v) => (v > m ? v : m), 0) ?? 0;
  // The three bands share one scale, the peak's: their colour is a ratio between them (packages/ui-waveform/docs/spectrum.md).
  const bands = [same(env.low), same(env.mid), same(env.high)];
  const banded = bands.every((b) => b !== undefined);
  return {
    intervalMs: Math.round(bucketSeconds * 1000),
    samples: normalise(downsample(env.rms, perBucket)),
    ...(peak ? { peak: normalise(peak) } : {}),
    ...(banded && top > 0
      ? {
          low: normalise(bands[0] ?? [], top),
          mid: normalise(bands[1] ?? [], top),
          high: normalise(bands[2] ?? [], top),
        }
      : {}),
    seconds: env.seconds,
    onsets: env.transients,
  };
}
