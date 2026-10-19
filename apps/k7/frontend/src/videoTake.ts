// videoTake.ts — recording a picture lane's input into a clip: which container the browser will
// actually give us, what the file is called, and where the shot lands. Pure, so the naming rule
// that ends up on disk is pinned without a camera and without a MediaRecorder.
// See docs/picture.md.

/** The containers to try, best first. WebM is the one every browser that records video records. */
export const VIDEO_MIMES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
] as const;

/** The first container this browser records, or undefined — which asks MediaRecorder to choose. */
export function pickVideoMime(
  supported: (m: string) => boolean,
): string | undefined {
  return VIDEO_MIMES.find(supported);
}

/** The extension a container lands under: the compiler reads a clip's KIND off it, so it has to be one it knows. */
export function extForMime(mime: string | undefined): string {
  return mime?.startsWith("video/mp4") ? ".mp4" : ".webm";
}

/** A wall-clock stamp for a filename — `260814T194357`, the shape a recorded audio take already uses. */
export function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** A take's clip id: the lane it was recorded on and when. Reduced to what a path and a k7x key hold. */
export function takeId(lane: string, stamp: string): string {
  const safe = lane.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  return `${safe || "lane"}_${stamp}`;
}

/**
 * The `picture add` line a finished take becomes. The length is MEASURED here rather than left to
 * the compiler: `length: 0` means "to the end of the source", and a WebM the browser wrote has no
 * duration in it until it is repaired — a number we already hold beats one nothing can read.
 */
export function placeLine(
  lane: string,
  id: string,
  atSec: number,
  lengthSec: number,
): string {
  const s = (n: number) => (Math.round(n * 1000) / 1000).toString();
  return `picture add ${lane} ${id} ${s(Math.max(0, atSec))} ${s(Math.max(0, lengthSec))}`;
}
