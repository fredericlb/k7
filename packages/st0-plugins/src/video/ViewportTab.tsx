// ViewportTab.tsx — the frame: the song's video lanes composited with WebGL, drawn against the
// engine's playhead. A `type: viewport` surface in the layout, so it is mounted for as long as
// the project is open — a GL context and one <video> per layer are exactly the state that must
// not be rebuilt every time you look elsewhere. See packages/song/docs/surfaces.md.

import { PROFILING } from "@studio/project-shell/profiling";
import {
  DEFAULT_VIDEO_FORMAT,
  type ExportSupport,
  probeExportSupport,
} from "@studio/ui-eyes/exportSupport";
import type { LaneDebug } from "@studio/ui-eyes/realtime";
import type { WebVideoProject } from "@studio/web-protocol";
import { useEffect, useMemo, useState } from "react";
import { sceneOf } from "./scene";
import { audioSources } from "./shaderAudio";
import { VideoCanvas } from "./VideoCanvas";
import { ViewportOverlay } from "./ViewportOverlay";
import type { Rect } from "./viewportRect";

export interface ViewportTabProps {
  /** The compiled picture, or null when this song carries none — see hooks/useVideoDoc.ts. */
  doc: WebVideoProject | null;
  error: string | null;
  /** The compiled track order — how the engine's `levels` array is indexed; only a shader with an audio input reads it. */
  trackIds?: readonly string[];
  /** A layer was moved or resized in the frame: `picture rect`'s four numbers (viewportRect.ts). */
  onRect?: (lane: string, rect: Rect) => void;
  readOnly?: boolean;
  /** The armed picture lane — what `monitor: auto` opens a lens for (../pictureMix.ts). */
  armed?: string | null;
}

export function ViewportTab({
  doc,
  error,
  trackIds,
  onRect,
  readOnly,
  armed,
}: ViewportTabProps) {
  // NOTHING of the engine's state is read here: `VideoCanvas` takes the frames off a raw subscription, so this pane commits on a document change.
  const [debug, setDebug] = useState<LaneDebug[]>([]);
  /** Which layer the frame has selected, and the canvas's letterboxed size the overlay must match. */
  const [selected, setSelected] = useState<string | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  /** Whether this build can encode the export, ASKED rather than assumed — see ui-eyes/exportSupport.ts. */
  const [canExport, setCanExport] = useState<ExportSupport | null>(null);

  // Asked once per viewport size, off the render path: isConfigSupported is async and the
  // answer only moves when the size does. Realtime works either way, so this gates the WORDS
  // rather than the pane — and it asks for the container the button sends, with its sound.
  const [vw, vh] = doc?.viewport ?? [1920, 1080];
  useEffect(() => {
    let live = true;
    void probeExportSupport(DEFAULT_VIDEO_FORMAT, vw, vh).then(
      (s) => live && setCanExport(s),
    );
    return () => {
      live = false;
    };
  }, [vw, vh]);

  // Rebuilt only when the DOCUMENT changes: the scene owns a GL context and a <video> per layer, and both would be torn down per frame.
  const scene = useMemo(
    () => (doc ? sceneOf(doc, armed ?? null) : null),
    [doc, armed],
  );
  // Which lane drives each shader pass, memoised beside the scene: the LEVELS move at 20 Hz, this map does not.
  const sources = useMemo(() => audioSources(doc), [doc]);

  if (error)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-red-400">
        {error}
      </div>
    );
  // Declared and empty is a real state: the surface says this song draws picture, and saying which file to add beats a black rectangle.
  if (!scene)
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {/* English in the package, the same rule the desk's views follow —
            the app's paraglide layer is for the app's own chrome. */}
        This project has no picture yet. Add
        <code className="mx-1">video_tracks/&lt;name&gt;.yaml</code> and a
        <code className="mx-1">viewport</code> in project.yaml.
      </div>
    );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        <VideoCanvas
          scene={scene}
          audioSources={sources}
          trackIds={trackIds}
          onDebug={PROFILING ? setDebug : undefined}
          onFit={setBox}
        >
          {/* The lanes come from the DOCUMENT and not from the scene: only the document says which is a shape lane. */}
          <ViewportOverlay
            tracks={doc?.videoTracks ?? []}
            viewport={scene.viewport}
            box={box}
            selected={selected}
            onSelect={setSelected}
            onRect={onRect}
            readOnly={readOnly}
          />
        </VideoCanvas>
      </div>
      {/* The strip: the format always, and the per-lane sync error only while profiling, it costing a 5 Hz re-render (docs/picture.md). */}
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
        {canExport?.ok === false && (
          <span className="ml-auto text-amber-400">{canExport.detail}</span>
        )}
      </div>
    </div>
  );
}
