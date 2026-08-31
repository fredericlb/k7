// analyse.ts — the one call a service makes: decode, measure, stamp, write the sidecar. The
// fingerprint is taken from the file on disk, so a sidecar written here is accepted by every
// reader that checks it, engine/moteur's included. See docs/analysis.md.

import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { decodeMono } from "./decode.ts";
import { buildEnvelope, DEFAULT_TRANSIENT_SENSITIVITY } from "./envelope.ts";
import { fileFingerprint } from "./fingerprint.ts";
import { readSidecar, writeSidecar } from "./sidecar.ts";

/** Analyse `source` and write `{source}.cache` beside it. */
export async function analyseFile(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
): Promise<FileEnvelope> {
  const fingerprint = fileFingerprint(source);
  const env = buildEnvelope(await decodeMono(source), fingerprint, sensitivity);
  writeSidecar(source, env);
  return env;
}

/** The sidecar when it still describes these bytes, else a fresh analysis — the usual entry point. */
export async function ensureAnalysed(
  source: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
): Promise<FileEnvelope> {
  const have = readSidecar(source);
  if (
    have &&
    have.fingerprint === fileFingerprint(source) &&
    have.sensitivity === sensitivity
  )
    return have;
  return analyseFile(source, sensitivity);
}
