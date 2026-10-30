// recordingName.ts — what a capture's path says on its own: when it was recorded, and whether it is a
// moment's clip rather than a capture. Pure, with no node:fs, so a browser reads names the same way.
// The one thing a reader would get wrong: the stamp is LOCAL time, the filer's wall clock (docs/recordings.md).

/** What a moment's clip file name starts with, in the day folder beside the captures. */
export const MOMENT_PREFIX = "moment-";

/** Is this file name a moment's clip, which the zone keeps but never lists as a capture? */
export const isMomentClip = (name: string): boolean =>
  name.startsWith(MOMENT_PREFIX);

const IN_ZONE = /^recordings\/[^/]+\/[^/]+\.[^./]+$/;
const STAMPED =
  /^recordings\/(\d{4})-(\d{2})-(\d{2})\/(\d{2})-(\d{2})-(\d{2})(?:-\d+)?\.[^./]+$/;

/** A capture's mediatek path, `recordings/<day>/<file>`: no other path can carry moments. */
export function isCapturePath(path: string): boolean {
  if (!IN_ZONE.test(path) || path.split("/").includes("..")) return false;
  return !isMomentClip(path.slice(path.lastIndexOf("/") + 1));
}

/** When a capture started, read off its `<day>/<HH-MM-SS>` name; null for a name the zone did not give. */
export function capturedAt(path: string): Date | null {
  const m = STAMPED.exec(path);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const at = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(at.getTime()) ? null : at;
}
