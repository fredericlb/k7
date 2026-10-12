// How many seconds before its timecode a clicked lyric line starts playing — a habit of the person, not
// a property of the song, so it is kept in this browser across songs. See ../../docs/lyricsTiming.md.

import { useState } from "react";

const KEY = "k7.lyricsLead";
export const DEFAULT_LYRICS_LEAD = 1;

/** A lead is seconds, never negative; anything else falls back to the default. */
export function parseLead(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_LYRICS_LEAD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LYRICS_LEAD;
}

export function useLyricsLead(): [number, (next: number) => void] {
  const [lead, setLead] = useState(() => {
    try {
      return parseLead(localStorage.getItem(KEY));
    } catch {
      return DEFAULT_LYRICS_LEAD; // storage blocked: the default still works
    }
  });
  const update = (next: number) => {
    const value = Number.isFinite(next) && next >= 0 ? next : 0;
    setLead(value);
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // storage blocked: the value holds for this page only
    }
  };
  return [lead, update];
}
