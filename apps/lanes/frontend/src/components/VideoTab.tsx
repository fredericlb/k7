// VideoTab.tsx — the viewport pane: fetch the compiled project, build an eyes VideoScene
// from its video tracks, and draw it live against the engine playhead. Exists only for a
// song with `video: true`, but still guards the empty case so a project that loses its
// video mid-session shows a message rather than a black rectangle.

import type { LaneDebug } from "@studio/ui-eyes/realtime";
import { buildScene, type VideoScene } from "@studio/ui-eyes/scene";
import { useEffect, useMemo, useState } from "react";
import { api, mediaUrl } from "../api";
import { useEngineState } from "../engineStore";
import type { WebProject } from "../types";
import { VideoCanvas } from "./VideoCanvas";

// Whether this browser can export (WebCodecs): realtime works everywhere, so say so rather than fail at frame 0.
const CAN_EXPORT = typeof window !== "undefined" && "VideoEncoder" in window;

export function VideoTab({ reloadKey }: { reloadKey: number }) {
  // Transport play + playhead from the store, so only the renderer follows the frames.
  const playing = useEngineState((s) => s.playing);
  const playhead = useEngineState((s) => s.playhead);
  const [proj, setProj] = useState<WebProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<LaneDebug[]>([]);

  useEffect(() => {
    api
      .projectDoc()
      .then((p) => {
        setProj(p);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [reloadKey]);

  // Build the eyes scene from the video tracks, memoized so the driver only rebuilds when the picture changes.
  const scene = useMemo<VideoScene | null>(() => {
    if (!proj?.video) return null;
    return buildScene(
      proj.viewport,
      proj.fps,
      proj.videoTracks.map((t) => ({
        id: t.id,
        mute: t.mute,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        clips: t.clips.map((c) => ({
          id: c.id,
          src: mediaUrl(c.src),
          start: c.start,
          length: c.length,
          sourceFrom: c.sourceFrom,
        })),
        // A shape track carries no media — the compositor rasterizes it; a per-shape id is synthesised for the scene.
        shapes: t.shapes.map((s, i) => ({ id: `${t.id}:${i}`, ...s })),
      })),
    );
  }, [proj]);

  if (error)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-red-400">
        {error}
      </div>
    );
  if (!scene)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        This project has no video. Set <code className="mx-1">video: true</code>{" "}
        and a <code className="mx-1">viewport</code> in project.yaml.
      </div>
    );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        <VideoCanvas
          scene={scene}
          playing={playing}
          playhead={playhead}
          onDebug={setDebug}
        />
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
            export needs Chrome (WebCodecs)
          </span>
        )}
      </div>
    </div>
  );
}
