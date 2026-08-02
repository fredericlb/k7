// RecordingOverlay.tsx — the fullscreen surface shown WHILE recording: a live waveform per
// armed track, a minimap of where the take sits, and a timer counting the pre-roll then the
// beats. The waveform is built from the same ~20 Hz inputLevels the meters use, accumulated
// and drawn off the store directly so the canvas updates without re-rendering the overlay.

import { Button } from "@frediverse/ui/button";
import {
  INPUT_VU_MAX_DB,
  INPUT_VU_MIN_DB,
  useEngineState,
  useEngineStore,
} from "@studio/engine-browser/store";
import { Circle, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

// The envelope is capped and then scrolls; at ~20 Hz that is ~200s, so most takes never scroll at all.
const MAX_BUCKETS = 4000;
const REC_COLOR = "#ef4444"; // red-500, matching the arm/record accent

// One input dB reading mapped to a 0..1 bar height, through the same range as the meters.
function dbToLevel(db: number): number {
  const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function RecordingOverlay({
  tempo,
  beatsPerBar,
  countIn,
  trackOrder,
  trackNames,
  onStop,
  children,
}: {
  tempo: number;
  // Quarter-note beats per bar (the project's time-sig numerator), for the count-in math.
  beatsPerBar: number;
  // Count-in length in bars (0 == none) — the overlay counts this down before the take.
  countIn: number;
  // The engine level index order, so an armed track id maps to its inputLevels slot.
  trackOrder: string[];
  trackNames: Record<string, string>;
  onStop: () => void;
  // The minimap strip (rendered by App, which owns its props), shown under the waveform.
  children?: ReactNode;
}) {
  const store = useEngineStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Per-track envelopes and the armed ids in refs, fed off the store, so the frame loop never re-renders this.
  const envRef = useRef<Map<string, number[]>>(new Map());
  const armedRef = useRef<string[]>([]);

  useEffect(() => {
    // Append one bucket per armed track on every engine frame.
    const unsub = store.subscribe(() => {
      const s = store.getSnapshot();
      armedRef.current = s.armed;
      for (const id of s.armed) {
        const i = trackOrder.indexOf(id);
        const db = i >= 0 ? (s.inputLevels[i] ?? -Infinity) : -Infinity;
        let buf = envRef.current.get(id);
        if (!buf) {
          buf = [];
          envRef.current.set(id, buf);
        }
        buf.push(dbToLevel(db));
        if (buf.length > MAX_BUCKETS) buf.shift();
      }
    });

    // Draw the accumulated envelopes, one stacked row per armed track, on a rAF loop.
    let raf = 0;
    const draw = () => {
      const cv = canvasRef.current;
      if (cv) {
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth;
        const h = cv.clientHeight;
        if (
          cv.width !== Math.round(w * dpr) ||
          cv.height !== Math.round(h * dpr)
        ) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          const ids = armedRef.current.length
            ? armedRef.current
            : [...envRef.current.keys()];
          const rows = Math.max(1, ids.length);
          const rowH = h / rows;
          const bw = Math.max(1, w / MAX_BUCKETS);
          ctx.fillStyle = REC_COLOR;
          ids.forEach((id, r) => {
            const buf = envRef.current.get(id);
            if (!buf) return;
            const cy = r * rowH + rowH / 2;
            for (let i = 0; i < buf.length; i++) {
              const bh = Math.max(1, buf[i] * (rowH - 24));
              ctx.fillRect((i / MAX_BUCKETS) * w, cy - bh / 2, bw, bh);
            }
          });
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [store, trackOrder]);

  // Esc stops the take, captured here so it reads as "leave the recording surface" while the overlay is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onStop();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStop]);

  // The timer re-renders on whole beats: the first frame is the pre-roll start, the take begins countInBeats later.
  const curBeat = useEngineState((s) =>
    Math.floor((s.playhead * tempo) / 60 + 1e-6),
  );
  const startBeatRef = useRef<number | null>(null);
  if (startBeatRef.current === null) startBeatRef.current = curBeat;
  const bpb = Math.max(1, beatsPerBar);
  const countInBeats = countIn * bpb;
  const targetBeat = (startBeatRef.current ?? 0) + countInBeats;
  const inCountIn = curBeat < targetBeat;
  const recordedBeats = Math.max(0, curBeat - targetBeat);
  // bar:beat of the take, 1-based, assuming x/4 — the common case and enough for a live counter.
  const bar = Math.floor(recordedBeats / bpb) + 1;
  const beatInBar = (recordedBeats % bpb) + 1;
  const armedNames = armedRef.current.map((id) => trackNames[id] ?? id);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background/98">
      {/* top: state + timer */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-3">
        <Circle className="h-4 w-4 animate-pulse fill-red-500 text-red-500" />
        {inCountIn ? (
          <div className="flex items-baseline gap-3">
            <span className="text-sm uppercase tracking-wider text-muted-foreground">
              Count-in
            </span>
            <span className="font-mono text-3xl tabular-nums text-red-400">
              {Math.max(0, targetBeat - curBeat)}
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-sm uppercase tracking-wider text-red-400">
              Recording
            </span>
            <span className="font-mono text-3xl tabular-nums">
              {bar}:{beatInBar}
            </span>
            <span className="text-sm text-muted-foreground">
              {recordedBeats} beats
            </span>
          </div>
        )}
        <span className="ml-2 truncate text-sm text-muted-foreground">
          {armedNames.length
            ? armedNames.join(", ")
            : "no armed tracks — arm one with A / r"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={onStop}
          title="Stop recording (Esc)"
        >
          <Square className="mr-1 h-3 w-3" /> Stop
        </Button>
      </div>

      {/* the live input waveform, filling the middle */}
      <div className="min-h-0 flex-1 p-4">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {/* the minimap strip — where the take sits in the song */}
      <div className="border-t border-border">{children}</div>
    </div>
  );
}
