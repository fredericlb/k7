// songWaveform.ts — the shape of a song's master, for the player pane: read the `.cache`
// sidecar the engine writes beside the audio and turn it into the Envelope @studio/ui-waveform
// draws. Nothing here decodes audio — the browser never has to. Every shape read is remembered,
// so the bar at the bottom draws the one the pane found. See ../docs/songPlayer.md.

import type { Envelope } from "@studio/ui-waveform";
import { useEffect, useSyncExternalStore } from "react";
import { type LibraryClient, library, libraryAt } from "./api";
import { Memo } from "./shapeMemo";

/** The sidecar's name, mirroring `CACHE_EXT`: to this app it is a file beside the audio. */
const CACHE_EXT = ".cache";

/** A structural SUBSET of the engine's `FileEnvelope`: the rest is the writer's business. */
interface SongEnvelope {
  seconds: number;
  /** Per-bucket RMS, 0..1 linear — exactly what Envelope.samples wants. */
  rms: number[];
  /** Per-bucket peak, the height of a spectrum column, and the three band peaks it is coloured by. */
  peak?: number[];
  low?: number[];
  mid?: number[];
  high?: number[];
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
  // A field of another length is not the same buckets: dropped, and the waveform draws without it.
  const same = (a?: number[]) =>
    Array.isArray(a) && a.length === e.rms.length ? a : undefined;
  return {
    envelope: {
      intervalMs: (e.seconds * 1000) / e.rms.length,
      samples: e.rms,
      peak: same(e.peak),
      low: same(e.low),
      mid: same(e.mid),
      high: same(e.high),
    },
    duration: e.seconds,
    transients: Array.isArray(e.transients) ? e.transients : [],
    bpm: typeof e.bpm === "number" ? e.bpm : 0,
  };
}

/** The shapes this tab has read, the song pane's and the bar's alike. */
const known = new Memo<SongShape>(16);

/** Read the sidecar beside `masterPath` through `from`, or null — an ABSENCE rather than a failure. */
export async function readSongShape(
  masterPath: string,
  from: LibraryClient = library,
): Promise<SongShape | null> {
  try {
    const { content } = await from.readFile(`${masterPath}${CACHE_EXT}`);
    const shape = shapeOf(JSON.parse(content));
    if (shape) known.set(masterPath, shape);
    return shape;
  } catch {
    return null;
  }
}

/** The shape of `path` if one exists, read once (under `base` when set) and then followed; it never asks for an analysis. */
export function useSongShape(
  path: string | null,
  base?: string,
): SongShape | null {
  const shape = useSyncExternalStore(known.subscribe, () =>
    path ? (known.get(path) ?? null) : null,
  );
  useEffect(() => {
    if (path && !known.has(path))
      void readSongShape(path, base ? libraryAt(() => base) : library);
  }, [path, base]);
  return shape;
}
