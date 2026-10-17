// mediaSeconds.ts — how long a dropped video runs and what shape it is, read by the browser off the
// file's own metadata. Null when this browser cannot read it (an HEVC .mov in Chrome): the shot is
// then placed with no length, as before, and runs to the end of its source.

/** Give up on a file whose metadata never arrives rather than holding the drop. */
const PROBE_TIMEOUT_MS = 5000;

/** What a drop needs to know about a video: its length in seconds and its frame size. */
export interface MediaInfo {
  seconds: number | null;
  width: number;
  height: number;
}

/** The file's duration and frame size, or null when the browser cannot read its metadata. */
export function mediaInfo(file: Blob): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (info: MediaInfo | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(() => done(null), PROBE_TIMEOUT_MS);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done({
        seconds: secondsOf(video.duration),
        width: video.videoWidth,
        height: video.videoHeight,
      });
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** A usable length, or null for the NaN / Infinity / zero a browser reports for what it cannot measure. */
export const secondsOf = (d: number): number | null =>
  Number.isFinite(d) && d > 0 ? Math.floor(d * 1000) / 1000 : null;

/** Whether a frame is taller than wide — what makes a phone clip ask for a 9:16 project. */
export const isPortrait = (i: Pick<MediaInfo, "width" | "height">): boolean =>
  i.width > 0 && i.height > i.width;
