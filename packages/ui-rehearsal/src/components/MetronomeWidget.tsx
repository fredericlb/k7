// The metronome, as a panel of the song page's rail: the recorder's own drift-free click track.
// It draws no floating button of its own any more — the rail owns where panels live, and a click
// track is a setting of the song you are reading like the others. See ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Minus, Music2, Play, Plus, Square } from "@frediverse/ui/icons";
import { useMetronome } from "@studio/recorder";
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
  const [bpm, setBpm] = useState(120);
  // The header flashes on each click — green on a bar's first beat, red on the others — so a FOLDED panel still keeps time.
  const [flash, setFlash] = useState<"bar" | "beat" | null>(null);
  const flashTimer = useRef<number | null>(null);
  const { metronome, start, stop } = useMetronome((downbeat) => {
    if (flashTimer.current != null) clearTimeout(flashTimer.current);
    setFlash(downbeat ? "bar" : "beat");
    flashTimer.current = window.setTimeout(
      () => setFlash(null),
      Math.min(150, (60 / bpm) * 500),
    );
  });
  const running = metronome != null;
  // A stopped click leaves no colour behind.
  useEffect(() => {
    if (running) return;
    if (flashTimer.current != null) clearTimeout(flashTimer.current);
    setFlash(null);
  }, [running]);

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
      <div className={`rail-panel-head${flash ? ` metro-${flash}` : ""}`}>
        <button
          type="button"
          className="rail-panel-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <Music2 className="size-4" />
          <span className="rail-panel-word">{m["metronome.title"]()}</span>
        </button>
        {/* On and off from the header, as the player's play/pause: it answers folded too. */}
        <button
          type="button"
          className="rail-panel-action"
          onClick={toggle}
          aria-pressed={running}
          aria-label={running ? m["common.stop"]() : m["common.start"]()}
          title={running ? m["common.stop"]() : m["common.start"]()}
        >
          {running ? (
            <Square className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </button>
      </div>

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
        </div>
      )}
    </aside>
  );
}
