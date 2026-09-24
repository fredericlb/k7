// The first panel of the page's right rail: how the song is read — its transposition, and how early
// a clicked lyric line starts — as opposed to what plays it (../../docs/audio.md).

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import {
  Minus,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from "@frediverse/ui/icons";
import { formatTranspose } from "@k7/score";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

interface Props {
  transpose: number;
  onTranspose: (next: (current: number) => number) => void;
  /** Seconds a clicked lyric line starts before its timecode. */
  lyricsLead: number;
  onLyricsLead: (seconds: number) => void;
  open: boolean;
  onToggle: () => void;
}

export function OptionsPanel({
  transpose,
  onTranspose,
  lyricsLead,
  onLyricsLead,
  open,
  onToggle,
}: Props) {
  // What is typed, so an emptied field stays empty while typing; the last valid number is what applies.
  const [leadText, setLeadText] = useState(String(lyricsLead));
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
        <div className="rail-panel-body options-grid">
          <span className="options-name muted small">
            {m["score.transpose"]()}
          </span>
          <div className="options-control">
            <Button
              variant="outline"
              size="icon-sm"
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
              size="icon-sm"
              onClick={() => onTranspose((t) => t + 1)}
              title={m["score.transposeUp"]()}
            >
              <Plus className="size-4" />
            </Button>
            {transpose !== 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onTranspose(() => 0)}
                title={m["score.transposeReset"]()}
                aria-label={m["panel.reset"]()}
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>

          <label className="options-name muted small" htmlFor="options-lead">
            {m["panel.lyricsLead"]()}
          </label>
          <div className="options-control">
            <Input
              id="options-lead"
              type="number"
              min={0}
              step={0.5}
              value={leadText}
              onChange={(e) => {
                const text = e.currentTarget.value;
                setLeadText(text);
                const n = Number(text);
                if (text.trim() !== "" && Number.isFinite(n) && n >= 0)
                  onLyricsLead(n);
              }}
              onBlur={() => setLeadText(String(lyricsLead))}
              title={m["panel.lyricsLeadHint"]()}
            />
            <span className="muted small">s</span>
          </div>
        </div>
      )}
    </aside>
  );
}
