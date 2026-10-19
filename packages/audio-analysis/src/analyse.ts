// analyse.ts — the one call a service makes: decode, measure, stamp, write the sidecar. The
// fingerprint is taken from the file on disk, so any reader can tell whether a sidecar still
// describes the bytes beside it. The measure runs on the Rust build where there is one, the JS
// one otherwise, and both write the same bytes. See docs/analysis.md.

import type { FileEnvelope } from "@studio/audio-probe/waveform";
import {
  type DecodeOptions,
  decodeFrames,
  decodeMono,
  MAX_DECODE_FRAMES,
} from "./decode.ts";
import {
  buildEnvelope,
  DEFAULT_TRANSIENT_SENSITIVITY,
  envelopeFrom,
  followers,
} from "./envelope.ts";
import { fileFingerprint } from "./fingerprint.ts";
import { type NativeMeasure, openMeasure } from "./native.ts";
import { readSidecar, writeSidecar } from "./sidecar.ts";

/** The envelope through the Rust build: each decoded chunk pushed as it arrives, measured once at the end. */
async function nativeEnvelope(
  native: NativeMeasure,
  source: string,
  fingerprint: string,
  sensitivity: number,
  options: DecodeOptions,
): Promise<FileEnvelope> {
  try {
    const facts = await decodeFrames(
      source,
      (samples, channels, frames) =>
        native.push(samples.subarray(0, frames * channels), channels),
      { maxFrames: MAX_DECODE_FRAMES, ...options },
    );
    const { aLow, aHigh } = followers(facts.sampleRate);
    return envelopeFrom(
      native.measure(aLow, aHigh),
      facts,
      fingerprint,
      sensitivity,
      native.correlations,
    );
  } finally {
    native.close();
  }
}

/** Analyse `source` and write `{source}.cache` beside it. */
export async function analyseFile(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
  options: DecodeOptions = {},
): Promise<FileEnvelope> {
  const fingerprint = fileFingerprint(source);
  const native = openMeasure();
  const env = native
    ? await nativeEnvelope(native, source, fingerprint, sensitivity, options)
    : buildEnvelope(
        await decodeMono(source, options),
        fingerprint,
        sensitivity,
      );
  writeSidecar(source, env);
  return env;
}

/** The sidecar when it still describes these bytes, or null — no decode, so a caller may ask before queueing one. */
export function freshSidecar(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
): FileEnvelope | null {
  const have = readSidecar(source);
  return have &&
    have.fingerprint === fileFingerprint(source) &&
    have.sensitivity === sensitivity
    ? have
    : null;
}
