// The metronome, as a panel of the song page's rail: the recorder's own drift-free click track.
// It draws no floating button of its own any more — the rail owns where panels live, and a click
// track is a setting of the song you are reading like the others. See ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Minus, Music2, Play, Plus, Square } from "@frediverse/ui/icons";
import { useMetronome } from "@k7/recorder";
import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";

const MIN = 40;
const MAX = 240;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

interface Props {
  open: boolean;
  onToggle: () => void;
}

export function MetronomeWidget({ open, onToggle }: Props) {
  const { metronome, start, stop } = useMetronome();
  const [bpm, setBpm] = useState(120);
  const running = metronome != null;

  // A live tempo change restarts the click a beat later, so a slider drag spares the context.
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the TEMPO is the trigger; re-running on `start` would restart the click on every render.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!metronome) return; // only re-apply while running
    const id = window.setTimeout(() => start(bpm, 0), 120);
    return () => clearTimeout(id);
  }, [bpm]);

  const toggle = () => (running ? stop() : start(bpm, 0));

  return (
    <aside className={`rail-panel${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="rail-panel-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Music2 className="size-4" />
        {/* The dot beats in the toggle, so a FOLDED panel still says the click is running. */}
        <span
          className={`metro-dot${running ? " beating" : ""}`}
          style={{ animationDuration: `${60 / bpm}s` }}
          aria-hidden
        />
        <span className="rail-panel-word">{m["metronome.title"]()}</span>
      </button>

      {open && (
        <div className="rail-panel-body">
          <div className="metro-bpm-row">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBpm((b) => clamp(b - 1))}
              aria-label={m["metronome.slower"]()}
            >
              <Minus className="size-4" />
            </Button>
            <div className="metro-bpm">
              <span className="metro-bpm-val">{bpm}</span>
              <span className="metro-bpm-unit">BPM</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBpm((b) => clamp(b + 1))}
              aria-label={m["metronome.faster"]()}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <input
            className="metro-slider"
            type="range"
            min={MIN}
            max={MAX}
            value={bpm}
            onChange={(e) => setBpm(clamp(Number(e.target.value)))}
            aria-label={m["metronome.tempo"]()}
          />

          <Button className="metro-toggle" onClick={toggle}>
            {running ? (
              <>
                <Square className="size-4" /> {m["common.stop"]()}
              </>
            ) : (
              <>
                <Play className="size-4" /> {m["common.start"]()}
              </>
            )}
          </Button>
        </div>
      )}
    </aside>
  );
}
