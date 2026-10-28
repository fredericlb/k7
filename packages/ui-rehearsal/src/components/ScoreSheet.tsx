// One score file on the Sheet tab: its toolbar — play, part, transpose, zoom — over alphaTab's view.
// The view is imported lazily, so the library loads only when a song shows a score (../../../score/docs/score.md).

import { Button } from "@frediverse/ui/button";
import { Minus, Plus, RotateCcw } from "@frediverse/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import {
  clampTranspose,
  formatTranspose,
  stepZoom,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  ZOOM_STEPS,
} from "@studio/score";
import type { ScoreState, ScoreViewHandle } from "@studio/score/ScoreView";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useElementFullscreen } from "../hooks/useElementFullscreen";
import { m } from "../paraglide/messages.js";

const ScoreView = lazy(() =>
  import("@studio/score/ScoreView").then((mod) => ({ default: mod.ScoreView })),
);

export function ScoreSheet({
  url,
  transpose: given = 0,
}: {
  url: string;
  /** Where the transposition starts, and goes back to whenever the page's changes. */
  transpose?: number;
}) {
  const view = useRef<ScoreViewHandle>(null);
  const [state, setState] = useState<ScoreState>({
    ready: false,
    loading: false,
    playing: false,
    parts: [],
  });
  const [transpose, setTranspose] = useState(() => clampTranspose(given));
  useEffect(() => setTranspose(clampTranspose(given)), [given]);
  const [scale, setScale] = useState(1);
  // Every part by default; a choice is kept with its file, so another file starts over at every part.
  const [chosen, setChosen] = useState<{ url: string; part: number | null }>();
  const part = chosen?.url === url ? chosen.part : null;
  const setPart = (p: number | null) => setChosen({ url, part: p });
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
          disabled={!state.ready || state.loading}
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

        {state.parts.length > 1 && (
          <Select
            value={part === null ? "all" : String(part)}
            onValueChange={(v) => setPart(v === "all" ? null : Number(v))}
          >
            <SelectTrigger size="sm" aria-label={m["score.part"]()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rehearsal-root">
              <SelectItem value="all">{m["score.allParts"]()}</SelectItem>
              {state.parts.map((name, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a part is its position in the score, names repeat
                <SelectItem key={i} value={String(i)}>
                  {name.trim() || m["score.partNumbered"]({ n: i + 1 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
        {transpose !== clampTranspose(given) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTranspose(clampTranspose(given))}
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
            part={part}
            onState={setState}
            onError={(e) => setError(e.message)}
          />
        </Suspense>
      )}
    </div>
  );
}
