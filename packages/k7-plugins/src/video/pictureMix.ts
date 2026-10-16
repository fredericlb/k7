// pictureMix.ts — which picture lanes are ON SCREEN. Two rules: the mute/solo fold, which is the
// mixer-wide one audio already keeps, and when a LENS opens. Pure, and in one place because the
// frame and the timeline both draw the answer and must not come to disagree.
// See apps/k7/frontend/docs/picture.md.

import type { CameraMonitor } from "@studio/song-video/videoDoc";

/** The little of a picture lane these two rules read. */
export interface MixLane {
  id: string;
  mute: boolean;
  solo: boolean;
  /** Present when a lens feeds this lane, in which case it draws the lens rather than its placements. */
  camera?: string;
  cameraMonitor?: CameraMonitor;
}

/** Is anything soloed? Then every lane that is not is off screen — the rule audio keeps, over picture. */
export const anyPictureSolo = (lanes: readonly MixLane[]): boolean =>
  lanes.some((l) => l.solo);

/**
 * Is this lane's lens open? `off` never, `on` always, `auto` while the lane is ARMED — the arm
 * being this browser's, since the camera is (hooks/useVideoRecording.ts). A lane with no lens
 * answers false: there is nothing to open.
 */
export function lensOpen(lane: MixLane, armed: string | null): boolean {
  if (lane.camera === undefined) return false;
  const m = lane.cameraMonitor ?? "on";
  return m === "on" || (m === "auto" && armed === lane.id);
}

/**
 * Is this lane off screen? Muted, soloed away, or fed by a lens that is not open — a lane drawing
 * a lens draws NOTHING when it is shut, since its placements are not what it was showing.
 */
export function laneHidden(
  lanes: readonly MixLane[],
  lane: MixLane,
  armed: string | null,
): boolean {
  if (lane.mute) return true;
  if (anyPictureSolo(lanes) && !lane.solo) return true;
  return lane.camera !== undefined && !lensOpen(lane, armed);
}
