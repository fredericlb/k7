// The first panel of the page's right rail: what changes how the song is DRAWN, as opposed to
// what plays it. Transposition is the only one so far, and the panel exists rather than a bare
// row because the next such setting should have somewhere to go — ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Minus, Plus, SlidersHorizontal } from "@frediverse/ui/icons";
import { formatTranspose } from "@k7/score";
import { m } from "../paraglide/messages.js";

interface Props {
  transpose: number;
  onTranspose: (next: (current: number) => number) => void;
  open: boolean;
  onToggle: () => void;
}

export function OptionsPanel({
  transpose,
  onTranspose,
  open,
  onToggle,
}: Props) {
  return (
    <aside className={`rail-panel${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="rail-panel-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <SlidersHorizontal className="size-4" />
        <span className="rail-panel-word">{m["panel.options"]()}</span>
      </button>
      {open && (
        <div className="rail-panel-body">
          <div className="cs-transpose">
            <span className="muted small">{m["score.transpose"]()}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTranspose((t) => t - 1)}
              title={m["score.transposeDown"]()}
            >
              <Minus className="size-4" />
            </Button>
            <span className="cs-transpose-val">
              {formatTranspose(transpose)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTranspose((t) => t + 1)}
              title={m["score.transposeUp"]()}
            >
              <Plus className="size-4" />
            </Button>
            {transpose !== 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTranspose(() => 0)}
                title={m["score.transposeReset"]()}
              >
                {m["panel.reset"]()}
              </Button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
