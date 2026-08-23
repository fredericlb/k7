// songWaveform.ts — the shape of a song's master, for the player pane: read the `.cache`
// sidecar the engine writes beside the audio and turn it into the Envelope @studio/ui-waveform
// draws. Nothing here decodes audio — the browser never has to. See ../docs/songPlayer.md.

import type { Envelope } from "@studio/ui-waveform";
import { library } from "./api";

/** The sidecar's name, mirroring `CACHE_EXT`: to this app it is a file beside the audio. */
export const CACHE_EXT = ".cache";

/** A structural SUBSET of the engine's `FileEnvelope`: the rest is the writer's business. */
export interface SongEnvelope {
  seconds: number;
  /** Per-bucket RMS, 0..1 linear — exactly what Envelope.samples wants. */
  rms: number[];
  /** Onsets in file seconds. Drawn as pins, so a verse is findable without listening for it. */
  transients?: number[];
  /** The engine's tempo estimate, 0 for "none found". */
  bpm?: number;
}

/** What the player pane got, and how. */
export interface SongShape {
  envelope: Envelope;
  duration: number;
  transients: number[];
  bpm: number;
}

/** A structural check and not a cast: the sidecar is a file anyone can overwrite. */
function shapeOf(raw: unknown): SongShape | null {
  const e = raw as SongEnvelope | null;
  if (!e || !Array.isArray(e.rms) || !e.rms.length) return null;
  if (!(e.seconds > 0)) return null;
  return {
    envelope: { intervalMs: (e.seconds * 1000) / e.rms.length, samples: e.rms },
    duration: e.seconds,
    transients: Array.isArray(e.transients) ? e.transients : [],
    bpm: typeof e.bpm === "number" ? e.bpm : 0,
  };
}

/** Read the sidecar beside `masterPath`, or null — an ABSENCE rather than a failure. */
export async function readSongShape(
  masterPath: string,
): Promise<SongShape | null> {
  try {
    const { content } = await library.readFile(`${masterPath}${CACHE_EXT}`);
    return shapeOf(JSON.parse(content));
  } catch {
    return null;
  }
}
