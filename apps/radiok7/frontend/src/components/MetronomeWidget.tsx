import { Button } from "@frediverse/ui/button";
import { useMetronome } from "@radiok7/recorder";
import { useEffect, useRef, useState } from "react";

const MIN = 40;
const MAX = 240;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

// A floating metronome for practising along with a song. Reuses the recorder's
// Web-Audio click track (drift-free); collapses to a small button when idle.
export function MetronomeWidget() {
  const { metronome, start, stop } = useMetronome();
  const [bpm, setBpm] = useState(120);
  const [open, setOpen] = useState(false);
  const running = metronome != null;

  // Live tempo change while running: restart the click track a beat after the
  // last change so dragging the slider doesn't thrash the AudioContext.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!metronome) return; // only re-apply while running
    const id = window.setTimeout(() => start(bpm, 0), 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm]);

  const toggle = () => (running ? stop() : start(bpm, 0));

  if (!open) {
    return (
      <button
        className={`metro-fab${running ? " on" : ""}`}
        title="Metronome"
        aria-label="Open metronome"
        onClick={() => setOpen(true)}
      >
        <span className="metro-fab-note">♩</span>
        {running && <span className="metro-fab-bpm">{bpm}</span>}
      </button>
    );
  }

  return (
    <div className="metro-widget" role="group" aria-label="Metronome">
      <div className="metro-head">
        <span className="metro-title">
          <span
            className={`metro-dot${running ? " beating" : ""}`}
            style={{ animationDuration: `${60 / bpm}s` }}
            aria-hidden
          />
          Metronome
        </span>
        <button
          className="metro-close"
          onClick={() => setOpen(false)}
          title="Hide"
          aria-label="Hide metronome"
        >
          ×
        </button>
      </div>

      <div className="metro-bpm-row">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBpm((b) => clamp(b - 1))}
          aria-label="Slower"
        >
          −
        </Button>
        <div className="metro-bpm">
          <span className="metro-bpm-val">{bpm}</span>
          <span className="metro-bpm-unit">BPM</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBpm((b) => clamp(b + 1))}
          aria-label="Faster"
        >
          +
        </Button>
      </div>

      <input
        className="metro-slider"
        type="range"
        min={MIN}
        max={MAX}
        value={bpm}
        onChange={(e) => setBpm(clamp(Number(e.target.value)))}
        aria-label="Tempo"
      />

      <Button className="metro-toggle" onClick={toggle}>
        {running ? "⏹ Stop" : "▶ Start"}
      </Button>
    </div>
  );
}
