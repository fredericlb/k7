// renderSettings.ts — the words that set a picture render, read in ONE place: the browser's
// `project export video` and the server's `picture render` take the same line, so they must read
// it alike. Pure and muxer-free, so the command line can load it. See apps/k7/frontend/docs/picture.md.

import { EXPORT_QUALITIES, type ExportQuality } from "./exportQuality";

/** The render's own settings, each optional: what a line leaves out is the viewport's, `high`, the whole song. */
export interface VideoSettings {
  /** A height in px (`720p`), the width following the viewport's aspect — or both (`1280x720`). */
  size?: { height: number } | { width: number; height: number };
  quality?: ExportQuality;
  from?: number; // seconds
  to?: number; // seconds
}

/** Seconds, or `m:ss(.s)` — the picture's own spelling of a time; null for anything else. */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const sec = Number(m[2]) + (m[1] ? Number(m[1]) * 60 : 0);
  return Number.isFinite(sec) ? sec : null;
}

// One `key=value` word into `into`; false when it is not one this understands.
function setting(word: string, into: VideoSettings): boolean {
  const [key, value = ""] = word.split("=", 2);
  if (key === "size") {
    const p = /^(\d+)p$/.exec(value);
    const wh = /^(\d+)x(\d+)$/.exec(value);
    if (p) into.size = { height: Number(p[1]) };
    else if (wh) into.size = { width: Number(wh[1]), height: Number(wh[2]) };
    else return false;
    return true;
  }
  if (key === "quality") {
    if (!(EXPORT_QUALITIES as readonly string[]).includes(value)) return false;
    into.quality = value as ExportQuality;
    return true;
  }
  if (key === "from" || key === "to") {
    const t = parseClock(value);
    if (t === null) return false;
    into[key] = t;
    return true;
  }
  return false;
}

/** The settings `words` say, or null when one is not understood or the range runs backwards. */
export function parseVideoSettings(
  words: readonly string[],
): VideoSettings | null {
  const out: VideoSettings = {};
  for (const w of words) if (!setting(w.toLowerCase(), out)) return null;
  if (out.from !== undefined && out.to !== undefined && out.to <= out.from)
    return null;
  return out;
}
