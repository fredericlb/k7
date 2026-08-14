// RecordingPane.tsx — a take, live and afterwards: a waveform per armed track over a bar/beat
// grid, and a timer counting the pre-roll then the beats. It takes the GRAPH's place like the
// note grids and the clip views do, and STAYS when the take ends — what you just played is
// what you want to look at — until the × puts the graph back. The waveform is built from the
// same ~20 Hz inputLevels the meters use, drawn off the store so the canvas needs no re-render.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import {
  INPUT_VU_MAX_DB,
  INPUT_VU_MIN_DB,
  useEngineState,
  useEngineStore,
} from "@studio/engine-browser/store";
import { Circle, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { beatLines, windowStart } from "../recordingWindow";
import { GraphSlotPane } from "./GraphSlotPane";

// The envelope is capped and then scrolls; at ~20 Hz that is ~200s, well past the window.
const MAX_FRAMES = 4000;
// How much of the take is on screen, in BARS — so the grid keeps its spacing at any tempo.
const WINDOW_BARS = 8;
const REC_COLOR = "#ef4444"; // red-500, matching the arm/record accent
// The same two the clip editor's ruler uses: bars readable, beats a rule behind the take.
const BAR_LINE = "rgba(120,180,255,0.45)";
const BEAT_LINE = "rgba(255,255,255,0.10)";

// One input dB reading mapped to a 0..1 bar height, through the same range as the meters.
function dbToLevel(db: number): number {
  const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Escape stops the take — unless it is answering a field, since the shell behind stays live.
function editable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n?.tagName) return false;
  return (
    n.tagName === "INPUT" ||
    n.tagName === "TEXTAREA" ||
    n.isContentEditable === true
  );
}

export function RecordingPane({
  tempo,
  beatsPerBar,
  countIn,
  trackOrder,
  trackNames,
  rolling,
  review,
  onStop,
  onClose,
}: {
  tempo: number;
  // Quarter-note beats per bar (the project's time-sig numerator), for the count-in math.
  beatsPerBar: number;
  // Count-in length in bars (0 == none) — the pane counts this down before the take.
  countIn: number;
  // The engine level index order, so an armed track id maps to its inputLevels slot.
  trackOrder: string[];
  trackNames: Record<string, string>;
  // Is a take actually rolling? False FREEZES the take rather than closing it: the engine keeps
  // pushing frames when the transport is stopped, and appending them would scroll what was just
  // played off the left for no reason.
  rolling: boolean;
  /**
   * What to do about the take now it is over — the review, drawn under the frozen envelope.
   *
   * A SLOT rather than the review itself: this pane is a live monitor drawn from meter frames and
   * knows nothing about clips, ids or the file service. The shell owns what lands here, which is
   * the same division `renderPreview` uses in the module builder.
   */
  review?: ReactNode;
  onStop: () => void;
  onClose: () => void;
}) {
  const store = useEngineStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read in the frame loop, which is bound once and must not be rebound on a transport change.
  const rollingRef = useRef(rolling);
  rollingRef.current = rolling;
  // Nothing new to draw: the loop keeps its slot but does no work, so a frozen take is not
  // redrawn 60 times a second for the length of time you leave it open.
  const dirtyRef = useRef(true);
  // The take, in refs so the frame loop never re-renders this: one beat position per engine
  // frame, and one level per frame per track, index-aligned with it.
  const framesRef = useRef<number[]>([]);
  const envRef = useRef<Map<string, number[]>>(new Map());
  const armedRef = useRef<string[]>([]);

  useEffect(() => {
    // Append one frame on every engine push: where the playhead is, and what each track hears.
    const unsub = store.subscribe(() => {
      const s = store.getSnapshot();
      armedRef.current = s.armed;
      if (!rollingRef.current) return; // the take is over — it is a picture now, not a recording
      dirtyRef.current = true;
      const n = framesRef.current.length;
      framesRef.current.push((s.playhead * tempo) / 60);
      for (const id of s.armed) {
        let buf = envRef.current.get(id);
        // Armed mid-take: pad back to this frame, so its envelope starts where it was armed
        // and not at the left edge, which would put it a bar or two ahead of the others.
        if (!buf) {
          buf = new Array<number>(n).fill(0);
          envRef.current.set(id, buf);
        }
        const i = trackOrder.indexOf(id);
        const db = i >= 0 ? (s.inputLevels[i] ?? -Infinity) : -Infinity;
        buf.push(dbToLevel(db));
      }
      // Disarmed mid-take: keep filling silence, or the indices stop meaning the same frame.
      for (const buf of envRef.current.values())
        if (buf.length === n) buf.push(0);
      if (framesRef.current.length > MAX_FRAMES) {
        framesRef.current.shift();
        for (const buf of envRef.current.values()) buf.shift();
      }
    });

    // The box comes from a ResizeObserver: reading clientWidth/clientHeight in the loop was two
    // layout flushes per SCREEN frame, paid even on the frames the dirty flag then skipped.
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      w = box.width;
      h = box.height;
      dirtyRef.current = true; // a resize clears the canvas: it has to be drawn again
    });
    if (canvasRef.current) ro.observe(canvasRef.current);

    // Draw the grid, then the accumulated envelopes, one stacked row per armed track, on a rAF loop.
    let raf = 0;
    const draw = () => {
      const cv = canvasRef.current;
      if (cv && dirtyRef.current && w > 0 && h > 0) {
        const dpr = window.devicePixelRatio || 1;
        if (
          cv.width !== Math.round(w * dpr) ||
          cv.height !== Math.round(h * dpr)
        ) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext("2d");
        if (ctx) {
          dirtyRef.current = false;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          const frames = framesRef.current;
          const bpb = Math.max(1, beatsPerBar);
          const win = WINDOW_BARS * bpb;
          const first = frames[0] ?? 0;
          const last = frames[frames.length - 1] ?? first;
          const t0 = windowStart(first, last, win);
          const xOf = (b: number) => ((b - t0) / win) * w;

          // The grid spans the WHOLE width, ahead of the take too: it is the ruler the take is
          // being written onto, and seeing the next bar arrive is most of what it is for.
          ctx.lineWidth = 1;
          for (const g of beatLines(t0, win, bpb, w)) {
            const x = Math.round(xOf(g.beat)) + 0.5;
            ctx.strokeStyle = g.bar ? BAR_LINE : BEAT_LINE;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }

          const ids = armedRef.current.length
            ? armedRef.current
            : [...envRef.current.keys()];
          const rows = Math.max(1, ids.length);
          const rowH = h / rows;
          // Proportional: a fixed gap swallows a row whole once four tracks share a short pane.
          const gap = Math.min(24, rowH * 0.25);
          const step =
            frames.length > 1 ? (last - first) / (frames.length - 1) : 0;
          const bw = Math.max(1, (step / win) * w);
          ctx.fillStyle = REC_COLOR;
          ids.forEach((id, r) => {
            const buf = envRef.current.get(id);
            if (!buf) return;
            const cy = r * rowH + rowH / 2;
            const n = Math.min(buf.length, frames.length);
            for (let i = 0; i < n; i++) {
              const x = xOf(frames[i]);
              if (x < -bw || x > w) continue; // scrolled off the left
              const bh = Math.max(1, buf[i] * (rowH - gap));
              ctx.fillRect(x, cy - bh / 2, bw, bh);
            }
          });
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [store, trackOrder, tempo, beatsPerBar]);

  // Esc stops the take, captured so it reads as "leave the take" wherever the pointer went.
  // Bound only while one is ROLLING: once it is over, Escape belongs to the shell again — this
  // pane is then just a picture, and taking the key for it would be taking it for nothing.
  useEffect(() => {
    if (!rolling) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editable(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        onStop();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStop, rolling]);

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
  // How long the take ran, kept from the last rolling frame. The counter above reads the LIVE
  // playhead, which goes back to wherever the transport left it the moment recording ends —
  // so once it is over, the length has to be remembered rather than recomputed.
  const takeBeats = useRef(0);
  if (rolling) takeBeats.current = recordedBeats;

  return (
    <GraphSlotPane
      onClose={onClose}
      // Its own strip rather than a title: this header carries CONTROLS — the take's state, its
      // beat count, and Stop. The frame adds the ✕ after them, with `ml-auto`, which reproduces
      // both layouts: with Stop present that button absorbs the space first and the ✕ follows it;
      // without, the ✕ takes it. Closing is not stopping — see below.
      bar={
        <>
          <Circle
            className={cn(
              "h-4 w-4",
              rolling
                ? "animate-pulse fill-red-500 text-red-500"
                : "fill-muted-foreground/40 text-muted-foreground/40",
            )}
          />
          {!rolling ? (
            <div className="flex items-baseline gap-3">
              <span className="text-sm uppercase tracking-wider text-muted-foreground">
                Take
              </span>
              <span className="font-mono text-2xl tabular-nums">
                {takeBeats.current}
              </span>
              <span className="text-sm text-muted-foreground">
                beats recorded
              </span>
            </div>
          ) : inCountIn ? (
            <div className="flex items-baseline gap-3">
              <span className="text-sm uppercase tracking-wider text-muted-foreground">
                Count-in
              </span>
              <span className="font-mono text-2xl tabular-nums text-red-400">
                {Math.max(0, targetBeat - curBeat)}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-3">
              <span className="text-sm uppercase tracking-wider text-red-400">
                Recording
              </span>
              <span className="font-mono text-2xl tabular-nums">
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
              : rolling
                ? "no armed tracks — arm one with A / r"
                : ""}
          </span>
          {rolling && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={onStop}
              title="Stop recording (Esc)"
            >
              <Square className="mr-1 h-3 w-3" /> Stop
            </Button>
          )}
        </>
      }
    >
      {/* the input waveform, filling the slot — it is bounded by the slot now, where it used to
          be a band in the column and had to name its own height to stay out of the way.
          Closing is not stopping: the frame's ✕ puts the graph back and leaves the take rolling,
          which is why it sits beside Stop rather than instead of it. */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 px-4 py-2">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        {/* …and UNDER it, once the take is over, what to do about it: the file's own waveform, its
            onsets, the button that brings it up to level. Here rather than in the column because
            this pane is what you are looking at after Stop — it takes the slot and keeps it — and
            a review three panes away is a review nobody finds. shell.md called deciding this an
            open question; this is the answer. Empty while a take rolls: there is nothing to say
            about a take that is still being played. */}
        {review}
      </div>
    </GraphSlotPane>
  );
}
