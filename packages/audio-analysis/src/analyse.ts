// analyse.ts — the one call a service makes: decode, measure, stamp, write the sidecar. The
// fingerprint is taken from the file on disk, so any reader can tell whether a sidecar still
// describes the bytes beside it. See docs/analysis.md.

import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { type DecodeOptions, decodeMono } from "./decode.ts";
import { buildEnvelope, DEFAULT_TRANSIENT_SENSITIVITY } from "./envelope.ts";
import { fileFingerprint } from "./fingerprint.ts";
import { readSidecar, writeSidecar } from "./sidecar.ts";

/** Analyse `source` and write `{source}.cache` beside it. */
export async function analyseFile(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
  options: DecodeOptions = {},
): Promise<FileEnvelope> {
  const fingerprint = fileFingerprint(source);
  const env = buildEnvelope(
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

/** The sidecar when it still describes these bytes, else a fresh analysis — the usual entry point. */
export async function ensureAnalysed(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
  options: DecodeOptions = {},
): Promise<FileEnvelope> {
  return (
    freshSidecar(source, sensitivity) ??
    analyseFile(source, sensitivity, options)
  );
}
