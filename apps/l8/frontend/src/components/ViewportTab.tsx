// ViewportTab.tsx — the frame: the song's video lanes composited with WebGL, drawn against the
// engine's playhead. A `type: viewport` surface in the layout, so it is mounted for as long as
// the project is open — a GL context and one <video> per layer are exactly the state that must
// not be rebuilt every time you look elsewhere. See packages/song/docs/surfaces.md.

import type { LaneDebug } from "@studio/ui-eyes/realtime";
import type { WebVideoProject } from "@studio/web-protocol";
import { useMemo, useState } from "react";
import { PROFILING } from "../profiling";
import { sceneOf } from "../scene";
import { VideoCanvas } from "./VideoCanvas";

// Whether this browser can export (WebCodecs): realtime works everywhere, so say so rather than fail at frame 0.
const CAN_EXPORT = typeof window !== "undefined" && "VideoEncoder" in window;

export function ViewportTab({
  doc,
  error,
}: {
  /** The compiled picture, or null when this song carries none — see hooks/useVideoDoc.ts. */
  doc: WebVideoProject | null;
  error: string | null;
}) {
  // NOTHING of the engine's state is read here, and that is the point: `VideoCanvas` takes the
  // frames off a raw subscription and feeds its clock, so this pane commits on a document change
  // and on nothing else. It used to subscribe to `playing` and `playhead` as two slices, with a
  // comment saying that was what kept it off the 20 Hz path — but the playhead is the field that
  // moves, so the pane and its subtree committed on every frame all the same.
  const [debug, setDebug] = useState<LaneDebug[]>([]);

  // Rebuilt only when the DOCUMENT changes, never on a playhead frame: the scene owns a GL
  // context and a <video> per layer, and rebuilding it sixty times a second would tear down both
  // sixty times a second.
  const scene = useMemo(() => (doc ? sceneOf(doc) : null), [doc]);

  if (error)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-red-400">
        {error}
      </div>
    );
  // Declared and empty is a real state, not a bug: the surface says this song draws picture, and
  // the lanes have not been written yet. Saying which file to add beats a black rectangle.
  if (!scene)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Ce projet n'a pas encore d'image. Ajoutez
        <code className="mx-1">video_tracks/&lt;nom&gt;.yaml</code> et un
        <code className="mx-1">viewport</code> dans project.yaml.
      </div>
    );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        <VideoCanvas scene={scene} onDebug={PROFILING ? setDebug : undefined} />
      </div>
      {/* The strip: the format always, and — only while profiling — the per-lane sync error, the
          verification signal that should settle small. It is a 5 Hz poll and a 5 Hz re-render of
          this pane, which is a fair price for someone looking and none at all for anyone else. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">
        <span>
          {scene.viewport[0]}×{scene.viewport[1]}
        </span>
        <span>{scene.fps}fps</span>
        {debug.map((d) => (
          <span key={d.id} className={d.active ? "" : "opacity-40"}>
            {d.id}: {d.active ? `${d.errMs}ms ×${d.rate.toFixed(2)}` : "—"}
          </span>
        ))}
        {!CAN_EXPORT && (
          <span className="ml-auto text-amber-400">
            l'export demande Chrome (WebCodecs)
          </span>
        )}
      </div>
    </div>
  );
}
