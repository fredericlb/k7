// OutputPicture.tsx — the picture RENDER sends out, drawn off screen while the output is recorded: the viewport's
// own scene on a driver that never parks, whose canvas the recording captures. Mounted only while a take rolls, so
// it costs a GL context only then. What reads wrong: it is not the viewport — that one may be hidden, and a hidden
// viewport stops drawing. See packages/song/docs/outputRecording.md.

import type { RealtimeDriver } from "@studio/ui-eyes/realtime";
import type { WebVideoProject } from "@studio/web-protocol";
import { useMemo } from "react";
import { sceneOf } from "./scene";
import { VideoCanvas } from "./VideoCanvas";

export function OutputPicture({
  doc,
  onDriver,
}: {
  doc: WebVideoProject;
  /** The driver once drawing, and null when it goes: what the recording captures its stream from. */
  onDriver: (driver: RealtimeDriver | null) => void;
}) {
  // Rebuilt only when the document changes, as the viewport's is: a scene owns a GL context and a <video> per layer.
  const scene = useMemo(() => sceneOf(doc), [doc]);
  const [w, h] = scene.viewport;
  return (
    // Off screen but laid out: a canvas with no box would draw nothing to capture.
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -10 * w,
        top: 0,
        width: w,
        height: h,
        pointerEvents: "none",
      }}
    >
      <VideoCanvas scene={scene} alwaysDraw onDriver={onDriver} />
    </div>
  );
}
