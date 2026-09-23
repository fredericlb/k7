// One score file on the Sheet tab: its toolbar — play, transpose, zoom — over alphaTab's view.
// The view is imported lazily, so the library loads only when a song shows a score (../../../docs/score.md).

import { Button } from "@frediverse/ui/button";
import {
  clampTranspose,
  formatTranspose,
  stepZoom,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  ZOOM_STEPS,
} from "@k7/score";
import type { ScoreState, ScoreViewHandle } from "@k7/score/ScoreView";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useElementFullscreen } from "../hooks/useElementFullscreen";
import { m } from "../paraglide/messages.js";

const ScoreView = lazy(() =>
  import("@k7/score/ScoreView").then((mod) => ({ default: mod.ScoreView })),
);

export function ScoreSheet({ url }: { url: string }) {
  const view = useRef<ScoreViewHandle>(null);
  const [state, setState] = useState<ScoreState>({
    ready: false,
    playing: false,
  });
  const [transpose, setTranspose] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const shift = (by: number) => setTranspose((t) => clampTranspose(t + by));
  // The toolbar and the score go full screen together, the score as one scrolling column under it.
  const sheet = useRef<HTMLDivElement>(null);
  const fullscreen = useElementFullscreen(sheet);

  return (
    <div
      ref={sheet}
      className={`score-sheet${fullscreen.active ? " is-fullscreen" : ""}`}
    >
      <div className="cs-transpose score-toolbar">
        <Button
          variant="outline"
          size="sm"
          disabled={!state.ready}
          onClick={() => view.current?.playPause()}
        >
          {state.playing ? m["score.pause"]() : m["score.play"]()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!state.ready}
          onClick={() => view.current?.stop()}
        >
          {m["score.stop"]()}
        </Button>

        <span className="muted small">{m["score.transpose"]()}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={transpose <= TRANSPOSE_MIN}
          onClick={() => shift(-1)}
          title={m["score.transposeDown"]()}
        >
          <Minus className="size-4" />
        </Button>
        <span className="cs-transpose-val">{formatTranspose(transpose)}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={transpose >= TRANSPOSE_MAX}
          onClick={() => shift(1)}
          title={m["score.transposeUp"]()}
        >
          <Plus className="size-4" />
        </Button>
        {transpose !== 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTranspose(0)}
            title={m["score.transposeReset"]()}
          >
            <RotateCcw className="size-4" />
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          disabled={scale <= ZOOM_STEPS[0]}
          onClick={() => setScale((s) => stepZoom(s, -1))}
          title={m["score.zoomOut"]()}
        >
          <Minus className="size-4" />
        </Button>
        <span className="cs-transpose-val">{Math.round(scale * 100)}%</span>
        <Button
          variant="outline"
          size="sm"
          disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          onClick={() => setScale((s) => stepZoom(s, 1))}
          title={m["score.zoomIn"]()}
        >
          <Plus className="size-4" />
        </Button>
        {/* Page layout already wraps to the panel, so fitting the width is the unscaled score. */}
        <Button
          variant="outline"
          size="sm"
          disabled={scale === 1}
          onClick={() => setScale(1)}
        >
          {m["score.fitWidth"]()}
        </Button>
        {fullscreen.available && (
          <Button variant="outline" size="sm" onClick={fullscreen.toggle}>
            {fullscreen.active
              ? m["score.exitFullscreen"]()
              : m["score.fullscreen"]()}
          </Button>
        )}
      </div>

      {error ? (
        <p className="muted">{m["score.error"]({ message: error })}</p>
      ) : (
        <Suspense fallback={<p className="muted">{m["score.loading"]()}</p>}>
          <ScoreView
            ref={view}
            url={url}
            transpose={transpose}
            scale={scale}
            onState={setState}
            onError={(e) => setError(e.message)}
          />
        </Suspense>
      )}
    </div>
  );
}
