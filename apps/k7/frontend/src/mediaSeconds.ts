// mediaSeconds.ts — how long a dropped video runs, read by the browser off the file's own metadata.
// Null when this browser cannot read it (an HEVC .mov in Chrome): the shot is then placed with no
// length, as before, and runs to the end of its source.

/** Give up on a file whose metadata never arrives rather than holding the drop. */
const PROBE_TIMEOUT_MS = 5000;

/** The file's duration in seconds, floored to the millisecond so a placement never outruns its source. */
export function mediaSeconds(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (s: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(s);
    };
    const timer = setTimeout(() => done(null), PROBE_TIMEOUT_MS);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(secondsOf(video.duration));
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** A usable length, or null for the NaN / Infinity / zero a browser reports for what it cannot measure. */
export const secondsOf = (d: number): number | null =>
  Number.isFinite(d) && d > 0 ? Math.floor(d * 1000) / 1000 : null;
