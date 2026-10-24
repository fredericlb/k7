// songTempo.ts — the song's one tempo, read off project.k7x for an edit that addresses an event by
// position: a `start` written in seconds reads as beats only through it (song-schema docs/timecode.md).

import { loadProjectRoot } from "@studio/song/loader";

/** `project.k7x`'s tempo, 120 when it states none — the compile's own default. */
export function songTempo(dir: string): number {
  const proj = (loadProjectRoot(dir).project ?? {}) as Record<string, unknown>;
  const t = Number(proj.tempo ?? 120);
  return Number.isFinite(t) && t > 0 ? t : 120;
}
