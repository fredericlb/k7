// TakesView.tsx — the TAKES mode of the waveform and piano roll panels: one row per take of the
// event, its own material first, on one song-time axis. A drag selects a span; a click on a row
// with a span picks that take for it (`event comp`), without one it moves the playhead. A MIDI
// event has no spans: a click picks a WHOLE take. Its record button records the next take INTO
// the event, from its start or punched into the span. See packages/song/docs/takes.md.

import { Button } from "@frediverse/ui/button";
import { Check, Circle, Square, Trash2, X } from "@frediverse/ui/icons";
import { setCompSpan } from "@studio/song-schema/takes";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { ModeIcon } from "../modeIcons";
import { m } from "../paraglide/messages.js";
import {
  compFadeLine,
  compLine,
  compSeams,
  heardSpans,
  snapSpan,
  type TakesEvent,
  takeColor,
} from "../takes";
import { TakeRow } from "./TakeRow";

/** What the shell lends the view: where the project's files are, and the record button's two acts. */
export interface TakesHost {
  /** The project's folder, workspace-relative ("." for the root). */
  projectPath: string;
  /** Arm the next take into `ev` and roll: punched into `to` when set, else from `from` to the stop. */
  record(ev: TakesEvent, from: number, to: number | null): void;
  stop(): void;
  /** A take of THIS view is being recorded. */
  recording: boolean;
}

/** What a panel needs to draw its takes mode: the host, the open event, and the song's time signature. */
export interface PanelTakes {
  host: TakesHost;
  ev: TakesEvent;
  num: number;
  den: number;
}

/** The air either side of the event, beats — room to start a take before it or let one run past. */
const PAD = 4;
/** What a drag snaps to, beats. */
const GRID = 0.25;

export function TakesView({
  ev: evProp,
  host,
  tempo,
  num,
  den,
  reloadKey,
  command,
  onSeek,
}: {
  ev: TakesEvent;
  host: TakesHost;
  tempo: number;
  num: number;
  den: number;
  reloadKey: number;
  command: (line: string) => void | Promise<void>;
  /** Seek the song, in SECONDS, as every other ruler does. */
  onSeek?: (seconds: number) => void;
}) {
  // A pick or a crossfade drawn at once, the server's answer replacing it — a new event is the truth.
  const [local, setLocal] = useState<{
    comp?: TakesEvent["comp"];
    crossfades?: TakesEvent["crossfades"];
    rows?: TakesEvent["rows"];
  }>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: the event's IDENTITY is the signal — a fresh one is the truth.
  useEffect(() => setLocal({}), [evProp]);
  const ev: TakesEvent = useMemo(
    () => ({ ...evProp, ...local }),
    [evProp, local],
  );
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const onLength = useCallback(
    (ref: string, beats: number) =>
      setLengths((l) => (l[ref] === beats ? l : { ...l, [ref]: beats })),
    [],
  );
  const rowEnd = (r: TakesEvent["rows"][number]) =>
    r.start + (lengths[r.ref] ?? Math.max(0, ev.to - r.start));
  // Every take's whole extent, not only the comp: a take recorded past the event must be pickable.
  const view = useMemo(() => {
    const ends = ev.rows.map(
      (r) => r.start + (lengths[r.ref] ?? Math.max(0, ev.to - r.start)),
    );
    return {
      from: Math.max(
        0,
        Math.min(ev.from, ...ev.rows.map((r) => r.start)) - PAD,
      ),
      to: Math.max(ev.to, ...ends) + PAD,
    };
  }, [ev, lengths]);
  // Each row's heard spans, kept per event and lengths so a memoised row sees the same array across a drag's renders.
  const heardOf = useMemo(() => {
    const out = new Map<string, { from: number; to: number }[]>();
    for (const r of ev.rows)
      out.set(
        r.ref,
        heardSpans(
          ev,
          r,
          r.start + (lengths[r.ref] ?? Math.max(0, ev.to - r.start)),
        ),
      );
    return out;
  }, [ev, lengths]);
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  // Notes are not swept between takes: a MIDI event plays one take whole, which keeps its roll one sequence.
  const wholeOnly = ev.kind === "midi";
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  // One pointer per drag, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();
  const area = useRef<HTMLDivElement>(null);
  const beatAt = (clientX: number): number => {
    const r = area.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return view.from;
    return view.from + ((clientX - r.left) / r.width) * (view.to - view.from);
  };
  const pct = (b: number) =>
    `${((b - view.from) / (view.to - view.from)) * 100}%`;
  const pos = (b: number) => beatsToPosition(b, num, den);
  const pick = (ref: string, whole?: { from: number; to: number }) => {
    const span = sel ?? whole;
    if (!span) return;
    // The writer's own rule, so what is drawn now is what the file will say (takeFile.ts).
    const from = Math.max(ev.start, span.from);
    if (span.to > from)
      setLocal((l) => ({
        ...l,
        comp: setCompSpan(ev.comp, { take: ref, from, to: span.to }, ev.ref),
      }));
    void command(compLine(ev, ref, span, num, den));
  };

  // The crossfade tool: a press takes the nearest seam, a drag sizes the crossfade, Alt takes it away.
  const [xfTool, setXfTool] = useState(false);
  const [xfDrag, setXfDrag] = useState<{ seam: number; length: number } | null>(
    null,
  );
  const seams = compSeams(ev);
  const onFadeDown = (e: React.PointerEvent) => {
    const b = beatAt(e.clientX);
    const seam = seams.reduce<number | null>(
      (m, s) => (m === null || Math.abs(s - b) < Math.abs(m - b) ? s : m),
      null,
    );
    if (seam === null) return;
    const alt = e.altKey;
    const lenAt = (x: number) =>
      Math.max(
        GRID / 2,
        Math.round((2 * Math.abs(beatAt(x) - seam)) / (GRID / 2)) * (GRID / 2),
      );
    setXfDrag({ seam, length: lenAt(e.clientX) });
    const move = (m: PointerEvent) =>
      setXfDrag({ seam, length: lenAt(m.clientX) });
    const up = (u: PointerEvent) => {
      setXfDrag(null);
      const length = alt ? 0 : lenAt(u.clientX);
      setLocal((l) => ({
        ...l,
        crossfades: [
          ...ev.crossfades.filter((x) => Math.abs(x.at - seam) > 1e-6),
          ...(length > 0 ? [{ at: seam, length }] : []),
        ],
      }));
      void command(compFadeLine(ev, seam, length, num, den));
    };
    // A cancelled fade drag writes no fade.
    follow(e, { move, end: up, cancel: () => setXfDrag(null) });
  };

  // A press on a row: a drag selects, a click picks the row for the span or, with none, seeks there.
  const onDown = (e: React.PointerEvent, row: TakesEvent["rows"][number]) => {
    if (e.button !== 0) return;
    if (wholeOnly) return pick(row.ref, { from: row.start, to: rowEnd(row) });
    if (xfTool) return onFadeDown(e);
    const ref = row.ref;
    const b = beatAt(e.clientX);
    setDrag({ a: b, b });
    const move = (m: PointerEvent) => setDrag({ a: b, b: beatAt(m.clientX) });
    const up = (u: PointerEvent) => {
      setDrag(null);
      const span = snapSpan(b, beatAt(u.clientX), GRID);
      if (span) return setSel(span);
      if (sel && ref) return pick(ref);
      onSeek?.((b * 60) / tempo);
    };
    // A cancelled press selects nothing and seeks nowhere.
    follow(e, { move, end: up, cancel: () => setDrag(null) });
  };

  // Escape lets the span go — caught first, so the panel behind the view is not closed by the same key.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setSel(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sel]);

  const shown = drag ? snapSpan(drag.a, drag.b, GRID) : sel;
  const bar = (num * 4) / den;
  const bars: number[] = [];
  for (let b = Math.ceil(view.from / bar) * bar; b < view.to; b += bar)
    bars.push(b);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          size="sm"
          variant={host.recording ? "default" : "outline"}
          onClick={() =>
            host.recording
              ? host.stop()
              : // The span's start when one is drawn, else the event's own: a take re-records a PART, from its top.
                host.record(ev, sel?.from ?? ev.start, sel?.to ?? null)
          }
          title={
            host.recording
              ? m["takes.stop"]()
              : sel
                ? m["takes.recordPunchHint"]({
                    from: pos(sel.from),
                    to: pos(sel.to),
                  })
                : m["takes.recordHint"]()
          }
          aria-label={host.recording ? m["takes.stop"]() : m["takes.record"]()}
        >
          {host.recording ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" />
          )}
        </Button>
        <span className="font-mono">
          {sel
            ? `${pos(sel.from)} → ${pos(sel.to)}`
            : m["takes.fromPosition"]({ position: pos(ev.start) })}
        </span>
        {sel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSel(null)}
            title={m["takes.clearSpanHint"]()}
            aria-label={m["takes.clearSpan"]()}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {/* Notes do not fade, so a MIDI event's seams take no crossfade (song docs/takes.md). */}
        {ev.kind === "audio" && (
          <Button
            size="sm"
            variant={xfTool ? "default" : "ghost"}
            onClick={() => setXfTool((v) => !v)}
            aria-pressed={xfTool}
            title={m["takes.crossfadeHint"]()}
            aria-label={m["takes.crossfadeTool"]()}
          >
            <ModeIcon mode="crossfade" />
          </Button>
        )}
        <span className="ml-auto">
          {xfTool
            ? seams.length
              ? m["takes.hintSeam"]()
              : m["takes.hintNoSeam"]()
            : wholeOnly
              ? m["takes.hintWhole"]()
              : sel
                ? m["takes.hintSpan"]()
                : m["takes.hintDrag"]()}
        </span>
      </div>
      {/* The song's bars, which a click seeks to — the one ruler of this view. */}
      <div className="flex shrink-0">
        <div className="w-24 shrink-0" />
        <button
          type="button"
          aria-label={m["takes.seek"]()}
          className="relative block h-4 min-w-0 flex-1 cursor-pointer border-b border-border/50 text-left font-mono text-[10px] text-muted-foreground"
          onClick={(e) => onSeek?.((beatAt(e.clientX) * 60) / tempo)}
        >
          {bars.map((b) => (
            <span
              key={b}
              className="absolute top-0 pl-0.5"
              style={{ left: pct(b) }}
            >
              {Math.round(b / bar) + 1}
            </span>
          ))}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
        {ev.rows.map((r, i) => {
          const heard = heardOf.get(r.ref) ?? [];
          const label = r.own
            ? m["takes.eventRow"]()
            : m["takes.takeRow"]({ n: i + 1 });
          return (
            <div key={r.ref} className="flex min-h-10 flex-1 basis-0">
              <div className="flex w-24 shrink-0 items-center gap-1 px-1 text-xs">
                <span
                  className={
                    heard.length ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {label}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 w-6 p-0"
                  onClick={() => pick(r.ref, { from: r.start, to: rowEnd(r) })}
                  title={sel ? m["takes.useOverSpan"]() : m["takes.useWhole"]()}
                  aria-label={m["takes.use"]({ label })}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                {!r.own && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      // Gone from the view at once, with every span it played — the writer's own rule.
                      setLocal((l) => ({
                        ...l,
                        rows: ev.rows.filter((x) => x.ref !== r.ref),
                        comp: ev.comp.filter((x) => x.take !== r.ref),
                      }));
                      void command(
                        `event take remove ${ev.track} ${ev.at} ${r.ref}`,
                      );
                    }}
                    title={m["takes.removeHint"]()}
                    aria-label={m["takes.remove"]({ label })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div
                ref={i === 0 ? area : undefined}
                className={`relative min-w-0 flex-1 rounded-sm bg-muted/30 ${wholeOnly ? "cursor-pointer" : "cursor-crosshair"}`}
                onPointerDown={(e) => onDown(e, r)}
                role="presentation"
              >
                <TakeRow
                  row={r}
                  kind={ev.kind}
                  label={label}
                  view={view}
                  heard={heard}
                  tempo={tempo}
                  num={num}
                  den={den}
                  prefix={
                    host.projectPath === "." ? "" : `${host.projectPath}/`
                  }
                  reloadKey={reloadKey}
                  color={takeColor(ev, r.ref)}
                  onLength={onLength}
                />
                {shown && (
                  <div
                    className="pointer-events-none absolute inset-y-0 bg-amber-400/20 ring-1 ring-amber-400/60"
                    style={{
                      left: pct(shown.from),
                      width: `calc(${pct(shown.to)} - ${pct(shown.from)})`,
                    }}
                  />
                )}
                {/* The crossfades at the seams, across every row: the span where one take hands over to the next. */}
                {[
                  ...ev.crossfades.filter(
                    (x) => !xfDrag || Math.abs(x.at - xfDrag.seam) > 1e-6,
                  ),
                  ...(xfDrag
                    ? [{ at: xfDrag.seam, length: xfDrag.length }]
                    : []),
                ].map((x) => (
                  <svg
                    key={`xf${x.at}`}
                    className="pointer-events-none absolute inset-y-0 h-full text-amber-300"
                    style={{
                      left: pct(x.at - x.length / 2),
                      width: `calc(${pct(x.at + x.length / 2)} - ${pct(x.at - x.length / 2)})`,
                    }}
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={m["takes.crossfade"]()}
                  >
                    <path
                      d="M0 1 L1 0 M0 0 L1 1"
                      stroke="currentColor"
                      strokeWidth={0.04}
                      vectorEffect="non-scaling-stroke"
                      fill="none"
                    />
                  </svg>
                ))}
                {xfTool &&
                  seams.map((sm) => (
                    <div
                      key={`seam${sm}`}
                      className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-amber-400/70"
                      style={{ left: pct(sm) }}
                    />
                  ))}
                <TakesPlayhead view={view} tempo={tempo} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The transport line over one row, written per animation frame onto its node, so the view never renders at the engine's rate (docs/playhead.md). */
function TakesPlayhead({
  view,
  tempo,
}: {
  view: { from: number; to: number };
  tempo: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const beat = (seconds * tempo) / 60;
        el.style.left = `${((beat - view.from) / (view.to - view.from)) * 100}%`;
      },
      [tempo, view],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 w-px bg-playhead"
    />
  );
}
