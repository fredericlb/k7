// camera.ts — opening a LIVE lens for a layer that names one. The matching is a pure function and
// is the half worth testing: a project says which camera by the LABEL a person reads, because a
// deviceId is salted per browser and per origin and one written into a committed file names
// nothing on the next machine. See packages/song/docs/camera.md.

/** The little of a `MediaDeviceInfo` this needs — declared structurally, so a test needs no DOM. */
export interface CameraDevice {
  deviceId: string;
  kind: string;
  label: string;
}

/** What matching a label answered, and WHY — a fallback that says nothing reads as a broken app. */
export interface CameraMatch {
  /** The device to open, or null to let the browser pick — which is also what "" asks for. */
  deviceId: string | null;
  /** Absent when the label was found, or when none was asked for. */
  problem?: string;
}

/** Which camera a layer's label names, among the devices this machine has.
 *
 * Exact first, then case-insensitively, then a containment either way: a browser dresses a label up
 * (`"Logitech BRIO (046d:085e)"`), and a person writing one down does not copy the ids. Nothing is
 * REFUSED — a lens that is not here falls back to the default and says so, because a project that
 * travels to a second machine has to draw something. */
export function matchCamera(
  label: string,
  devices: readonly CameraDevice[],
): CameraMatch {
  const cams = devices.filter((d) => d.kind === "videoinput");
  // "" is not "no camera": it is "whichever this machine calls default" — the ordinary state.
  if (!label) return { deviceId: null };
  if (!cams.length)
    return { deviceId: null, problem: "this machine reports no camera at all" };
  const want = label.trim().toLowerCase();
  const hit =
    cams.find((d) => d.label === label) ??
    cams.find((d) => d.label.trim().toLowerCase() === want) ??
    cams.find((d) => d.label.toLowerCase().includes(want)) ??
    cams.find((d) => want.includes(d.label.trim().toLowerCase()) && !!d.label);
  if (hit) return { deviceId: hit.deviceId };
  return {
    deviceId: null,
    // The names it DOES have: without them the sentence cannot be acted on.
    problem:
      `no camera called "${label}" on this machine — using the default one ` +
      `(it has: ${cams.map((d) => d.label || "an unnamed camera").join(", ")})`,
  };
}

/** The constraint a match becomes. `exact` deliberately NOT used: an id that has rotated since the
 *  page was last open would then fail outright rather than fall back to a picture. */
export const cameraConstraint = (m: CameraMatch): MediaStreamConstraints => ({
  video: m.deviceId ? { deviceId: m.deviceId } : true,
  audio: false,
});
