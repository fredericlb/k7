// Viewport.tsx — the picture itself: an eyes VideoScene built from the project's lanes, drawn
// live against v1's own transport. It used to be l8's VideoTab, following an engine playhead;
// what changed is only where the seconds come from.

import type { TransportClock } from "@studio/ui-eyes/clock";
import type { LaneDebug } from "@studio/ui-eyes/realtime";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { useState } from "react";
import { VideoCanvas } from "../components/VideoCanvas";

// Whether this browser can export (WebCodecs): realtime works everywhere, so say so rather than fail at frame 0.
const CAN_EXPORT = typeof window !== "undefined" && "VideoEncoder" in window;

export function Viewport({
  scene,
  clock,
}: {
  scene: VideoScene | null;
  clock: TransportClock;
}) {
  const [debug, setDebug] = useState<LaneDebug[]>([]);

  if (!scene || !scene.layers.length)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Rien à afficher : ce montage n'a aucune piste dans{" "}
        <code className="mx-1">project.layers</code>.
      </div>
    );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        <VideoCanvas scene={scene} clock={clock} onDebug={setDebug} />
      </div>
      {/* Debug strip: per-lane sync error, the verification signal (should settle small). */}
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
