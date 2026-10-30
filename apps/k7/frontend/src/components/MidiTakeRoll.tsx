// MidiTakeRoll.tsx — the event panel while a MIDI take rolls: the notes drawn as they are played,
// held keys growing, on a window that follows the playhead and a pitch range that widens to what
// was played. Read-only and transient: the moment the take lands it gives way to the clip's own
// piano roll. Not PianoRoll itself, which fits its view ONCE per clip — a take outgrows that fit.

import { Button } from "@frediverse/ui/button";
import { Music2, Square } from "@frediverse/ui/icons";
import { useEffect, useRef, useState } from "react";
import type { LiveMidiTake } from "../hooks/useMidiRecording";
import { isBlack } from "../noteNames";
import { m } from "../paraglide/messages.js";
import { barBeat, takeCounter } from "../takeCounter";
import type { CapturedNote } from "../webmidi";

// How many bars the window shows, and the fewest semitones it spans.
const WINDOW_BARS = 8;
const MIN_KEYS = 24;
const KEYS_W = 28;

/** The key range drawn: what was played, padded, never narrower than two octaves — C3..C5 before the first note. */
export function keyRange(notes: CapturedNote[]): { lo: number; hi: number } {
  if (!notes.length) return { lo: 48, hi: 72 };
  // A loop, not Math.min(...keys): spread past ~100k arguments throws, and an hour's jam gets there.
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    if (n.k < lo) lo = n.k;
    if (n.k > hi) hi = n.k;
  }
  lo -= 2;
  hi += 2;
  const short = MIN_KEYS - (hi - lo);
  if (short > 0) {
    lo -= Math.floor(short / 2);
    hi += Math.ceil(short / 2);
  }
  return { lo: Math.max(0, lo), hi: Math.min(127, hi) };
}

/** The beats drawn: from the take's start, sliding once the playhead nears the right edge. */
export function beatWindow(
  from: number,
  now: number,
  barBeats: number,
): { lo: number; hi: number } {
  const span = WINDOW_BARS * barBeats;
  const hi = Math.max(from + span, (Math.floor(now / barBeats) + 2) * barBeats);
  return { lo: Math.max(from, hi - span), hi };
}

export function MidiTakeRoll({
  take,
  trackName,
  beatsPerBar,
  countInBeats,
  onStop,
}: {
  take: LiveMidiTake;
  trackName: string;
  beatsPerBar: number;
  countInBeats: number;
  onStop: () => void;
}) {
  const [frame, setFrame] = useState<{ notes: CapturedNote[]; now: number }>(
    () => ({ notes: [], now: take.now() }),
  );
  // The playhead line moves every animation frame through its ref; the notes are re-read each quarter beat.
  const lineRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ lo: 0, hi: 1 });
  useEffect(() => {
    let id = 0;
    let step = Number.NaN;
    const tick = () => {
      const now = take.now();
      const { lo, hi } = viewRef.current;
      if (lineRef.current)
        lineRef.current.style.transform = `translateX(${((now - lo) / (hi - lo)) * 100}%)`;
      // A held key grows and a new note appears within a quarter beat, without a React render per frame.
      const at = Math.floor(now * 4);
      if (at !== step) {
        step = at;
        setFrame({ notes: take.read(), now });
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [take]);

  const { notes, now } = frame;
  const bar = Math.max(1, beatsPerBar);
  const keys = keyRange(notes);
  const beats = beatWindow(take.from, now, bar);
  viewRef.current = beats;
  const rows = keys.hi - keys.lo + 1;
  const x = (b: number) => ((b - beats.lo) / (beats.hi - beats.lo)) * 100;
  const y = (k: number) => ((keys.hi - k) / rows) * 100;
  const count = takeCounter(
    take.from - countInBeats,
    Math.floor(now + 1e-6),
    countInBeats,
  );
  const at = barBeat(Math.max(0, now - take.from), bar);
  const barLines: number[] = [];
  for (let b = Math.ceil(beats.lo / bar) * bar; b < beats.hi; b += bar)
    barLines.push(b);

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-1 bg-card/40 px-3 py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {count.phase === "count-in" ? (
          <>
            <span className="text-sm uppercase tracking-wider">
              {m["clip.countIn"]()}
            </span>
            <span className="font-mono text-2xl tabular-nums text-red-400">
              {count.beats}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm uppercase tracking-wider text-red-400">
              {m["clip.recording"]()}
            </span>
            <span className="font-mono text-2xl tabular-nums">
              {at.bar}:{at.beat}
            </span>
          </>
        )}
        <span className="truncate">{trackName}</span>
        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
          <Music2 className="h-3 w-3" />
          {notes.length}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={onStop}
          title={m["clip.stopTake"]()}
        >
          <Square className="mr-1 h-3 w-3" /> Stop
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded border border-border bg-background">
        {/* The keys: a C is named, a black key shaded, so a pitch reads without counting rows. */}
        <div className="relative h-full shrink-0" style={{ width: KEYS_W }}>
          {Array.from({ length: rows }, (_, i) => {
            const k = keys.hi - i;
            const black = isBlack(k);
            return (
              <div
                key={k}
                className={`absolute left-0 right-0 border-b border-border/40 pl-0.5 text-[8px] leading-none text-muted-foreground ${black ? "bg-muted" : ""}`}
                style={{ top: `${y(k)}%`, height: `${100 / rows}%` }}
              >
                {k % 12 === 0 ? `C${Math.floor(k / 12) - 1}` : ""}
              </div>
            );
          })}
        </div>
        <div className="relative h-full min-w-0 flex-1">
          {barLines.map((b) => (
            <div
              key={b}
              className="absolute top-0 h-full w-px bg-border"
              style={{ left: `${x(b)}%` }}
            />
          ))}
          {/* Only the notes the window shows: an hour's take is thousands, and every one off screen was reconciled each quarter beat. */}
          {notes
            .filter((n) => n.t + n.d >= beats.lo && n.t <= beats.hi)
            .map((n) => (
              <div
                key={`${n.t}:${n.k}`}
                className="absolute rounded-sm bg-red-500"
                style={{
                  left: `${x(n.t)}%`,
                  width: `${Math.max(0.3, x(n.t + n.d) - x(n.t))}%`,
                  top: `${y(n.k)}%`,
                  height: `${100 / rows}%`,
                  opacity: 0.45 + 0.55 * n.v,
                }}
              />
            ))}
          {/* A full-width layer moved by a transform, so the line costs no layout per frame (docs/playhead.md). */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              ref={lineRef}
              className="absolute inset-0"
              style={{ transform: `translateX(${x(now)}%)` }}
            >
              <div className="h-full w-px bg-foreground/70" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
