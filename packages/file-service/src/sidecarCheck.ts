// sidecarCheck.ts — whether a source's `{file}.cache` sidecar still answers: its threshold read, the file
// fingerprinted, the sidecar parsed. Shared by the request thread and the worker (analyseWorker.ts), which
// is where it runs: a burst of a project's waveforms parsed every sidecar whole on the one thread.

import { DEFAULT_TRANSIENT_SENSITIVITY } from "@studio/audio-analysis/envelope";
import { fileFingerprint } from "@studio/audio-analysis/fingerprint";
import { readSidecar, storedSensitivity } from "@studio/audio-analysis/sidecar";
import type { FileEnvelope } from "@studio/audio-probe/waveform";

/** The sidecar's envelope when it still matches the file at the threshold asked; else the threshold to build at. */
export interface SidecarCheck {
  env?: FileEnvelope;
  /** What a decode should use: the threshold asked, else the one the sidecar carried, else the default. */
  sensitivity: number;
}

export function checkSidecar(
  source: string,
  sensitivity?: number,
): SidecarCheck {
  const wanted = sensitivity ?? storedSensitivity(source);
  const cached = readSidecar(source);
  const usable =
    !!cached &&
    (sensitivity === undefined || cached.sensitivity === sensitivity) &&
    cached.fingerprint === fileFingerprint(source);
  return usable && cached
    ? { env: cached, sensitivity: wanted ?? DEFAULT_TRANSIENT_SENSITIVITY }
    : { sensitivity: wanted ?? DEFAULT_TRANSIENT_SENSITIVITY };
}
