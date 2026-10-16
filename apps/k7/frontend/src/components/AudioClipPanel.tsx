// AudioClipPanel.tsx — ONE panel for an audio clip, whether it is being recorded or being worked
// on. While a take rolls it draws the envelope the engine is pushing, growing; the moment the
// recorder closes the file it draws that file instead, with its onsets, its threshold and the
// button that brings it up to level. Same waveform, same place, one view of one clip.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Check, Loader2, Square, Trash2 } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { DEFAULT_TRIM_DB, trimWindow } from "@studio/audio-probe/trim-gate";
import { arrayEq, useEngineState } from "@studio/engine-browser/store";
import { projectApi } from "@studio/project-shell/project";
import { followPointer } from "@studio/ui-timeline/drag";
import { wheelFactor } from "@studio/ui-timeline/panZoom";
import {
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import { anchorBars, barWindow, frameWindow, zoomBars } from "../barWindow";
import { clamp } from "../clamp";
import { chainOps, filterOps, processLine } from "../clipOps";
import { warpLine } from "../clipWarp";
import type { MenuCtx } from "../contextMenu";
import { useLiveEnvelope } from "../hooks/useLiveEnvelope";
import { cursorOf, ModeStrip } from "../modeIcons";
import { m } from "../paraglide/messages.js";
import { barBeat, takeCounter } from "../takeCounter";
import { pieceEdgeLines } from "../takes";
import type { WebWaveform } from "../types";
import {
  WAVE_MODES,
  WAVE_PRESS,
  WAVE_SOLO_MODES,
  type WaveMode,
} from "../waveMode";
import { ChainOpsList } from "./ChainOpsList";
import { OnsetThreshold, TrimGateMenu } from "./ClipGateControls";
import { CompStrip } from "./CompStrip";
import { EventGainSlider } from "./EventGainSlider";
import { LiveSeconds, LiveTakeWave, LiveWaveform } from "./LiveWaveform";
import { LoopBrace, LoopToggle } from "./LoopBrace";
import { ArrangementRuler } from "./Ruler";
import { type PanelTakes, TakesView } from "./TakesView";

// The waveform fills whatever the panel has left under its header, MEASURED because a canvas needs its height in pixels; 120 is only the first frame.
const MIN_WAVE_H = 120;
const BUCKETS = 1200;

/** How many bars the waveform shows before you ask for more — twelve, about what a phrase tends to be. */
const DEFAULT_BARS = 12;
// Stable empty defaults: a fresh `[]` per render is a new identity, and one of these feeds a memo.
const NO_TRACKS: string[] = [];
const NO_NAMES: Record<string, string> = {};
// The chain token, the filter and the command line live in ../clipOps.ts — two surfaces, one spelling.

/** What the shell drives on the AUDIO leaf — the counterpart of `ClipGridHandle` for the three note grids. */
export interface AudioClipHandle {
  /** `ui wave <mode>` — the three views are also the three gestures, so one verb sets both (waveMode.ts). */
  setView: (v: WaveMode) => void;
}

export function AudioClipPanel({
  clip: clipProp,
  track,
  rolling = false,
  tempo = 120,
  beatsPerBar = 4,
  countIn = 0,
  startBeat = 0,
  trackOrder = NO_TRACKS,
  trackNames = NO_NAMES,
  placedAt: placedAtProp = null,
  eventAt: eventAtProp = null,
  eventWindow: eventWindowProp = null,
  loops = 1,
  gainDb = 0,
  onSeek,
  command,
  quietCommand,
  onContextMenu,
  reloadKey = 0,
  onStop,
  onClose,
  onDiscard,
  viewRef,
  onViewChange,
  setStatus,
  takes,
}: {
  /** The clip on screen — null while a take is rolling, since the file does not exist yet. */
  clip: string | null;
  track: string;
  /** Is a take being played right now? It decides which of the two pictures this draws — everything below is the RECORDING half, and optional. */
  rolling?: boolean;
  tempo?: number;
  /** Quarter-note beats per bar, for the counter AND for the twelve-bar window — worth passing even with no take in sight. */
  beatsPerBar?: number;
  /** Count-in length in BARS (0 == none) — the header counts it down before the take. */
  countIn?: number;
  /** The beat this take started on — the shell's, so the counter and the lane's growing clip agree. */
  startBeat?: number;
  /** The engine level index order, so an armed track maps to its inputLevels slot. */
  trackOrder?: string[];
  /** Track id → display name, for naming who is being recorded; which tracks those ARE comes off the engine store here. */
  trackNames?: Record<string, string>;
  /** The arrangement beat where the clip's window PLAYS — null for a clip nothing places. */
  placedAt?: number | null;
  /** This event's start as a TIMECODE — given rather than derived, since turning a beat into one needs the time signature. */
  eventAt?: string | null;
  /** The window THIS EVENT plays, in seconds of the file, already intersected by the compiler (nodeProject.ts); null outside any placement. */
  eventWindow?: { from?: number; to?: number } | null;
  /** How many times the event plays that window — more than one is a LOOP, which the switch and the ruler's brace edit. */
  loops?: number;
  /** The event's own trim in dB, as its placement states it — the header's slider edits it. */
  gainDb?: number;
  /** Seek the transport, in SONG seconds — what a click on that ruler does. */
  onSeek?: (seconds: number) => void;
  /** Runs a command line through the shell, which journals it — so every edit here is one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  /** …and the same, WITHOUT the shell-wide reload, for an edit that changes nothing outside this clip; absent ⇒ everything goes the loud way. */
  quietCommand?: (line: string) => void | Promise<void>;
  /** Bumped by the shell after a command it reloaded on — what re-reads the picture when the edit came from OUTSIDE the panel. */
  reloadKey?: number;
  /** Open the shell's right-click menu — absent ⇒ the browser's own; the shell's, so an entry here is the same kind of thing as one on a clip. */
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /** Stop the take. Absent when there is no take to stop — a clip opened from the timeline. */
  onStop?: () => void;
  onClose: () => void;
  /** Throw the take just recorded away — absent for a clip opened from the timeline, which is not a recording to regret. */
  onDiscard?: () => void;
  /** Where the shell reaches this panel's MODE — `ui wave <mode>` arrives here, as the timeline's tools do (waveMode.ts). */
  viewRef?: RefObject<AudioClipHandle | null>;
  /** …and the same fact going up, for the key conditions and the footer's badge. */
  onViewChange?: (v: WaveMode | null) => void;
  /** Where this panel says what a press would do — a mode you cannot see is one you edit in by accident. */
  setStatus?: (s: string) => void;
  /** The takes mode's event and shell half; absent, the mode is not offered (song docs/takes.md). */
  takes?: PanelTakes;
}) {
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined asks for whatever threshold the file was last built with; a number re-detects AND remembers it in the sidecar.
  const [sensitivity, setSensitivity] = useState<number | undefined>(undefined);
  /** The chains this clip can be run through, as `clip process` names them — fetched once when the panel opens. */
  const [chains, setChains] = useState<string[] | null>(null);
  const [opSearch, setOpSearch] = useState("");
  useEffect(() => {
    let live = true;
    projectApi
      .libraryChains()
      .then((r) => live && setChains(chainOps(r.chains)))
      .catch(() => live && setChains([]));
    return () => {
      live = false;
    };
  }, []);
  // Filtered on the whole ref, so a word is found wherever it sits — a chain is filed by path, and nobody remembers the folder.
  const ops = useMemo(
    () => filterOps(chains ?? [], opSearch),
    [chains, opSearch],
  );

  const [busy, setBusy] = useState<string | null>(null);
  // The trim gate, in dBFS, and whether its menu is open — open is what draws the preview, so the two travel together.
  const [gate, setGate] = useState(DEFAULT_TRIM_DB);
  const [gateOpen, setGateOpen] = useState(false);
  // The window the person asked for: how many bars, and from which bar — ONE state, since a zoom about the cursor writes both together.
  const [asked, setAsked] = useState({ bars: DEFAULT_BARS, start: 0 });
  /** What the picture is FOR right now, and so what it draws and what a click means — the three answers are exclusive in practice. */
  const [view, setView] = useState<WaveMode>("standard");
  // Takes is a mode only where there is an event to take over: a reviewed take or a bare file has none.
  const showTakes = view === "takes" && !!takes && !rolling;
  // A COMPED event is edited a piece at a time: the strip picks one, and the wave below is that piece (CompStrip.tsx).
  const pieces = takes?.ev.comp.length ? takes.ev.pieces : [];
  const [pieceId, setPieceId] = useState<string | null>(null);
  const piece = rolling
    ? null
    : (pieces.find((p) => p.id === pieceId) ?? pieces[0] ?? null);
  const clip = piece ? piece.id : clipProp;
  const placedAt = piece ? piece.start : placedAtProp;
  const eventWindow = piece
    ? { from: piece.sourceFrom, to: piece.sourceTo }
    : eventWindowProp;
  // A piece is no placement: the event verbs refuse it, so trim is off and its edges edit the comp instead.
  const eventAt = piece ? null : eventAtProp;
  const editingOnsets = view === "onsets";
  const editingWarp = view === "warp";
  // `standard` keeps the system's arrow: it places no mark, so there is nothing for a picture to promise.
  const waveCursor = view === "standard" ? undefined : cursorOf(view);
  // The shell's way in and this panel's way out — the select above dispatches the command, so both ends meet here.
  useImperativeHandle(viewRef, (): AudioClipHandle => ({ setView }), []);
  useEffect(() => onViewChange?.(view), [view, onViewChange]);
  // …and NULL on the way out: a MIDI clip opened next would otherwise leave the shell believing a waveform is still on screen.
  useEffect(() => () => onViewChange?.(null), [onViewChange]);
  // What a press would do, said on every change of mode: three pictures that take three different gestures.
  useEffect(() => {
    if (!rolling) setStatus?.(`${view} — ${WAVE_PRESS[view]}`);
  }, [view, rolling, setStatus]);
  // The box the waveform fills, measured (see MIN_WAVE_H); the width came along for the arrangement ruler.
  const waveBox = useRef<HTMLDivElement>(null);
  const [waveH, setWaveH] = useState(MIN_WAVE_H);
  const [waveW, setWaveW] = useState(0);
  useEffect(() => {
    const el = waveBox.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      setWaveH(Math.max(MIN_WAVE_H, Math.floor(e[0].contentRect.height)));
      setWaveW(Math.floor(e[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Esc stops the take, captured so it reads as 'leave the take' wherever the pointer went, and only while one is ROLLING.
  useEffect(() => {
    if (!rolling) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable === true;
      if (e.key === "Escape" && !typing) {
        e.preventDefault();
        e.stopPropagation();
        onStop?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStop, rolling]);
  // `arrayEq`: `armed` is a new array every frame, and without it the panel re-rendered at frame rate.
  const armed = useEngineState((s) => s.armed, arrayEq);
  const armedNames = armed.map((id) => trackNames[id] ?? id);

  // The transport's position in beats, re-rendering on whole beats only: one that followed every 20 Hz frame would redraw the waveform beside it.
  const curBeat = useEngineState((s) =>
    Math.floor((s.playhead * tempo) / 60 + 1e-6),
  );
  // `startBeat` arrives from the shell, taken on the rolling edge — a capture per MOUNT measured every later take against the first (takeCounter.ts).
  const count = takeCounter(startBeat, curBeat, countIn * beatsPerBar);
  /** The count-in is not the take: nothing is recorded during it, so nothing is drawn and nothing is COLLECTED — `recording` is the honest edge. */
  const counting = rolling && count.phase === "count-in";
  const live = useLiveEnvelope(rolling && !counting, trackOrder);
  // From Stop until the file's picture arrives, the take as it was heard stays up rather than a blank "reading" line.
  const [bridging, setBridging] = useState(false);
  useEffect(() => {
    if (rolling) setBridging(true);
  }, [rolling]);
  useEffect(() => {
    if (wf) setBridging(false);
  }, [wf]);
  const bridge = bridging && !rolling && live.length() > 0;
  // No 'how long it ran' kept once it stops: the panel switches to the FILE, whose own length is the honest answer.
  const at = barBeat(count.beats, beatsPerBar);

  // `whole`: the take is the file, and the onsets a command names are seconds into THAT, not into the placement's span.
  const load = useCallback(() => {
    if (!clip) return;
    api
      .waveform(clip, BUCKETS, true, sensitivity)
      .then((w) => {
        setWf(w);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [clip, sensitivity]);
  // `reloadKey` is a TRIGGER, not a value `load` reads: an edit from the right-click menu went through the shell, not through `run`.

  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — dropping it leaves a removed point drawn.
  useEffect(load, [load, reloadKey]);

  // Every edit is a command followed by a re-read, serialised through `busy`; `quiet` skips the shell-wide reload for an edit confined to THIS clip.
  const run = async (line: string, label: string, quiet = false) => {
    if (busy) return;
    setBusy(label);
    try {
      await ((quiet && quietCommand) || command)(line);
      load();
    } finally {
      setBusy(null);
    }
  };

  // The corrected set — the file service has already applied the clip's corrections, so this is what the onsets ARE.
  const onsets = wf?.transients ?? [];
  /** Everywhere the pane may roam: the whole file, since a window can only be judged against what lies outside it. */
  const reach = useMemo(() => ({ from: 0, to: wf?.seconds ?? 0 }), [wf]);
  /** The interval this EVENT plays — the event's window first, then the clip's, then the file, clamped against a window the file outgrew. */
  const act = useMemo(() => {
    const dur = wf?.seconds ?? 0;
    const w = eventWindow ?? wf?.sourceWindow;
    const from = clamp(w?.from ?? 0, 0, dur);
    const to = clamp(w?.to ?? dur, 0, dur);
    return to > from ? { from, to } : { from: 0, to: dur };
  }, [wf, eventWindow]);
  /** Is the event a SLICE of the file, or all of it? Decides whether the frame is worth offering. */
  const framed = act.from > 1e-6 || act.to < reach.to - 1e-6;
  /** Is this second inside the event — refused rather than clamped, since an onset appearing on the edge would be an edit nobody made. */
  const inside = (sec: number) =>
    sec >= act.from - 1e-6 && sec <= act.to + 1e-6;
  // The onsets split by that line: pins in, plain rules out. Same list, two ways of drawing it.
  const inAct = onsets.filter(inside);
  const outsideAct = onsets.filter((t) => !inside(t));
  /** What a trim at this gate would KEEP, drawn as a selection: the SAME `trimWindow` the command runs, over the same pair. */
  const keep = useMemo(
    () => (gateOpen && wf ? trimWindow(wf.rms, wf.seconds, gate, act) : null),
    [gateOpen, wf, gate, act],
  );
  // The window on the FILE: `asked.bars` bars from `asked.start` — the maths and its edges live in barWindow.ts.
  const win = barWindow(reach, asked.bars, tempo, beatsPerBar, asked.start);
  /** Frame the event, with a bar of context either side — what the panel opens on. */
  const frameOnEvent = useCallback(
    () =>
      setAsked(
        frameWindow(
          reach,
          act,
          (Math.max(1, beatsPerBar) * 60) / Math.max(1, tempo),
        ),
      ),
    [reach, act, beatsPerBar, tempo],
  );
  /** …and do it when the event being looked at CHANGES, not on every re-read, or each edit would throw away the zoom. */
  const framedKey = `${clip ?? ""}|${act.from}|${act.to}`;
  const lastFramed = useRef<string | null>(null);
  useEffect(() => {
    if (!wf || lastFramed.current === framedKey) return;
    lastFramed.current = framedKey;
    frameOnEvent();
  }, [wf, framedKey, frameOnEvent]);
  // Beats per second — the whole of the conversion, since there is no tempo map.
  const bps = Math.max(1e-6, tempo / 60);
  /** The event the loop verbs address, or null: a piece of a comp is no placement, and an unplaced clip has none. */
  const loopAddr = !piece && eventAt && track ? `${track} ${eventAt}` : null;
  const looped = loops > 1;

  /** Zoom about a point, anchored so the moment under `clientX` stays put — `nextBars` reads the CURRENT window through the updater. */
  const zoomTo = useCallback(
    (
      nextBars: (cur: { bars: number; allBars: number }) => number,
      clientX: number,
      box: HTMLElement,
    ) => {
      const r = box.getBoundingClientRect();
      if (r.width <= 0) return;
      const frac = clamp((clientX - r.left) / r.width, 0, 1);
      setAsked((a) => {
        const cur = barWindow(reach, a.bars, tempo, beatsPerBar, a.start);
        const next = clamp(
          nextBars({ bars: cur.shown, allBars: cur.allBars }),
          1,
          cur.allBars,
        );
        return {
          bars: next,
          start: anchorBars(cur.view, frac, next, cur.barSec, reach.from),
        };
      });
    },
    [reach, tempo, beatsPerBar],
  );

  // What is shown RIGHT NOW, for the pinch to measure from: the gesture outlives any render, so its baseline cannot live in a closure.
  const shownRef = useRef(win.shown);
  shownRef.current = win.shown;
  // …and where the window actually SITS, in bars into the reach — the CLAMPED start, not `asked`, and a ref for the same reason.
  const atRef = useRef({ start: 0, bars: 1 });
  atRef.current = {
    start: win.barSec > 0 ? (win.view.start - reach.from) / win.barSec : 0,
    bars: win.shown,
  };

  /** Middle-drag pans as on every other pane (`usePanScroll`), written out because this one draws a view span rather than scrolling. */
  useEffect(() => {
    const el = waveBox.current;
    if (!el || rolling || !wf) return;
    let from: { x: number; start: number; barPx: number } | null = null;
    // The pan in progress, abandoned with the effect: the pane can go away mid-drag.
    let abandon: (() => void) | null = null;
    const onMove = (e: PointerEvent) => {
      const f = from;
      if (!f) return;
      // Pixels back into bars, and negated: the window goes the other way from the hand.
      setAsked((a) => ({
        ...a,
        start: f.start - (e.clientX - f.x) / f.barPx,
      }));
    };
    const stop = () => {
      abandon = null;
      if (!from) return;
      from = null;
      el.style.cursor = "";
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1) return; // middle button only
      const w = el.getBoundingClientRect().width;
      const bars = atRef.current.bars;
      if (w <= 0 || bars <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      from = { x: e.clientX, start: atRef.current.start, barPx: w / bars };
      el.style.cursor = "grabbing";
      // A release and a cancel end it alike: a pan has nothing to undo.
      abandon = followPointer(e, { move: onMove, end: stop, cancel: stop });
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      abandon?.();
      el.style.cursor = "";
    };
  }, [rolling, wf]);

  /** Two fingers on the wave, bound natively because React's touch listeners are passive — the same arithmetic as `useHZoom`'s pinch. */
  useEffect(() => {
    const el = waveBox.current;
    if (!el || rolling || !wf) return;
    let pinch: { dist: number; bars: number } | null = null;
    const spread = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2)
        pinch = { dist: spread(e.touches), bars: shownRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spread(e.touches);
      if (d <= 0) return;
      const p = pinch;
      const centre = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      zoomTo(() => p.bars * (p.dist / d), centre, el);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [rolling, wf, zoomTo]);

  return (
    /** `w-full min-w-0 flex-1` and not only `h-full`: this panel takes the GRAPH's place, which is a flex ROW, and the canvas sizes itself to its parent. */
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-1 bg-card/40 px-3 py-2"
      aria-label={rolling ? m["clip.takeRolling"]() : `clip ${clip ?? ""}`}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {rolling ? (
          <>
            {/* The pre-roll counts DOWN, then the take counts up in bar:beat from where THIS take started (docs/shell.md). */}
            {count.phase === "count-in" ? (
              <>
                <span className="text-sm uppercase tracking-wider text-muted-foreground">
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
            <span className="truncate">
              {armedNames.length
                ? armedNames.join(", ")
                : m["clip.noArmedTrack"]()}
            </span>
            <span className="font-mono tabular-nums">
              <LiveSeconds live={live} />
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
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{clip}</span>
            {/* A clip nothing places has no lane to name, and works the same: waveform, onsets and level belong to the FILE. */}
            {track ? (
              <span>{m["clip.onTrack"]({ track })}</span>
            ) : (
              <span>{m["clip.offTrack"]()}</span>
            )}
            {editingOnsets && (
              <span className="text-muted-foreground/70">
                {m["clip.onsetHint"]()}
              </span>
            )}
            {editingWarp && (
              <span className="text-muted-foreground/70">
                {m["clip.warpHint"]()}
              </span>
            )}
            {/* What is on screen and the two ways out: a window showing only some bars without saying so reads as a clip that was cut. */}
            {wf && win.allBars > 1 && (
              <span className="whitespace-nowrap tabular-nums">
                {Math.round(win.shown)}/{win.allBars} {m["clip.bars"]()}
                {win.shown < win.allBars && (
                  <button
                    type="button"
                    className="ml-1 underline hover:text-foreground"
                    onClick={() => setAsked({ bars: win.allBars, start: 0 })}
                  >
                    {m["clip.allBars"]()}
                  </button>
                )}
                {framed && (
                  <button
                    type="button"
                    className="ml-1 underline hover:text-foreground"
                    onClick={frameOnEvent}
                    title={m["clip.backToEvent"]({
                      from: act.from.toFixed(2),
                      to: act.to.toFixed(2),
                    })}
                  >
                    {m["clip.theEvent"]()}
                  </button>
                )}
              </span>
            )}

            {/* The event's own loop: its switch, and — when on — its points in the ruler below. */}
            <span className="ml-auto flex items-center gap-3">
              <EventGainSlider
                db={gainDb}
                onCommit={
                  loopAddr
                    ? (db) =>
                        void command(`event gain ${loopAddr} ${db.toFixed(1)}`)
                    : undefined
                }
              />
              <LoopToggle
                on={looped}
                onToggle={
                  loopAddr
                    ? (on) =>
                        void command(
                          `event loop ${loopAddr} ${on ? "on" : "off"}`,
                        )
                    : undefined
                }
              />
            </span>
            {/* What the picture is for — and the select DISPATCHES the command rather than doubling it (docs/shell.md). */}
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              {m["clip.view"]()}
              <select
                className="rounded border border-input bg-background px-1 py-0.5"
                value={view}
                onChange={(e) => void command(`ui wave ${e.target.value}`)}
                aria-label={m["clip.viewLabel"]()}
              >
                {WAVE_MODES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {/* The threshold belongs to the onset editor alone: under a stretch job a slider rewriting the sidecar would be a trap. */}
            {editingOnsets && (
              <OnsetThreshold value={sensitivity} onChange={setSensitivity} />
            )}

            {/* Trim OPENS a gate rather than applying one, drawing what would be KEPT over the wave (docs/shell.md). */}
            <TrimGateMenu
              open={gateOpen}
              onOpenChange={(o) => setGateOpen(o && !!clip)}
              gate={gate}
              onGate={setGate}
              keep={keep}
              busy={busy === "trim"}
              disabled={!!busy || !clip}
              canTrim={!!keep && !busy && !!eventAt && !!track}
              onTrim={() => {
                setGateOpen(false);
                // The EVENT is the bound, and naming it is all the command needs — the same pair the preview above was drawn against.
                if (eventAt && track)
                  void run(`event trim ${track} ${eventAt} ${gate}`, "trim");
              }}
            />
            {/* Operations: every chain the project and the library offer, run over THIS clip (@studio/commands docs/processChain.md). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!busy || !clip}>
                  {busy === "process" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "operations"
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-1">
                <ChainOpsList
                  search={opSearch}
                  onSearch={setOpSearch}
                  ops={ops}
                  pending={chains === null}
                  onPick={(c) =>
                    clip && void run(processLine(clip, c), "process")
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {onDiscard && (
              <Button
                size="sm"
                variant="outline"
                onClick={onDiscard}
                title={m["clip.discardHint"]()}
                aria-label={m["clip.discard"]()}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" onClick={onClose} title={m["clip.done"]()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      {/* The take list beside the wave: one row when there is nothing to choose between, two columns after several passes. */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* The three views as a 32px column — the only way to one a finger has; absent while a take rolls, there being no mark yet. */}
        {!rolling && clip && (
          <ModeStrip
            modes={takes ? WAVE_MODES : WAVE_SOLO_MODES}
            current={view}
            onPick={(m) => void command(`ui wave ${m}`)}
            title={(m) => `${m} — ${WAVE_PRESS[m]}`}
            className="-my-2 -ml-2"
          />
        )}
        {/* The TAKES mode draws in the wave's place; the wave stays mounted, hidden, so its state survives a switch. */}
        {showTakes && takes && (
          <TakesView
            ev={takes.ev}
            host={takes.host}
            tempo={tempo}
            num={takes.num}
            den={takes.den}
            reloadKey={reloadKey}
            command={command}
            onSeek={onSeek}
          />
        )}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-1",
            showTakes && "hidden",
          )}
        >
          {/* A comped event: its parts in their takes' colours, the one clicked being the one below. */}
          {piece && takes && (
            <CompStrip
              ev={takes.ev}
              selected={piece.id}
              onSelect={(p) => setPieceId(p.id)}
              project={{ tempo, timeSigNumerator: takes.num }}
            />
          )}
          {/* The SONG's ruler over the wave (Ruler.tsx), the placement's grid rather than the warp — see docs/clipEditors.md. */}
          {!rolling &&
            wf &&
            placedAt != null &&
            waveW > 0 &&
            win.view.end > win.view.start && (
              <div className="relative shrink-0">
                <ArrangementRuler
                  // `placedAt` is the beat the event's window starts playing at, so the song's beat here is measured from `act.from`.
                  startBeat={placedAt + (win.view.start - act.from) * bps}
                  beats={(win.view.end - win.view.start) * bps}
                  ppb={waveW / ((win.view.end - win.view.start) * bps)}
                  barBeats={beatsPerBar}
                  tempo={tempo}
                  height={18}
                  onSeek={onSeek}
                  className="shrink-0 border-b border-border/50 font-mono text-[10px] text-muted-foreground"
                />
                {/* The loop's points on the FILE's seconds, the axis the event's window is written in. */}
                {looped && loopAddr && (
                  <LoopBrace
                    from={act.from}
                    to={act.to}
                    toPx={(sec) =>
                      ((sec - win.view.start) /
                        (win.view.end - win.view.start)) *
                      waveW
                    }
                    fromPx={(x) =>
                      win.view.start +
                      (x / waveW) * (win.view.end - win.view.start)
                    }
                    min={reach.from}
                    max={reach.to}
                    onCommit={(f, t) =>
                      void command(
                        `event loop points ${loopAddr} ${f.toFixed(4)} ${t.toFixed(4)}`,
                      )
                    }
                  />
                )}
              </div>
            )}
          {/* Two pictures, one frame: what the engine is hearing while it rolls, the file the service wrote once it stops. */}
          {/* The wheel zooms the window ANCHORED under the cursor, a trackpad pinch arriving as Ctrl+wheel (@studio/ui-timeline/panZoom). */}
          <div
            ref={waveBox}
            // The view's own icon AS the pointer — `standard` keeps the system's, having no mark to place (modeIcons.tsx).
            style={waveCursor ? { cursor: waveCursor } : undefined}
            className={cn(
              "min-h-0 flex-1 touch-none",
              waveCursor && "[&_*]:!cursor-[inherit]",
            )}
            onWheel={(e) => {
              if (rolling || !wf) return;
              e.preventDefault();
              const box = e.currentTarget;
              zoomTo(
                (cur) =>
                  e.ctrlKey
                    ? cur.bars / wheelFactor(e.deltaY, true)
                    : zoomBars(cur.bars, e.deltaY, cur.allBars),
                e.clientX,
                box,
              );
            }}
          >
            {counting ? (
              // Nothing is being recorded yet, so there is nothing to draw — the header is already counting the pre-roll down.
              <p className="py-6 text-center text-sm text-muted-foreground">
                {m["clip.countingIn"]()}
              </p>
            ) : rolling || (bridge && !error) ? (
              <LiveTakeWave live={live} height={waveH} />
            ) : error ? (
              <p className="py-6 text-center text-sm text-red-500">{error}</p>
            ) : !clip ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {m["clip.noTake"]()}
              </p>
            ) : !wf ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {m["clip.readingTake"]()}
              </p>
            ) : (
              <LiveWaveform
                // Where this event sits in the song, and which slice of the file it plays — what turns the transport into a second of THIS picture.
                placedAt={placedAt}
                act={act}
                tempo={tempo}
                // k7's one waveform, the desk's: the PEAK as height and the three bands as colour (packages/ui-waveform/docs/spectrum.md).
                look="spectrum"
                envelope={{
                  intervalMs: wf.intervalMs,
                  samples: wf.rms,
                  peak: wf.peak,
                  low: wf.low,
                  mid: wf.mid,
                  high: wf.high,
                }}
                duration={wf.seconds}
                height={waveH}
                // The project's bars and beats, straight from the same endpoint — the same three fields, so no translation is needed.
                gridLines={wf.grid}
                // Twelve bars by default: a minute of take drawn across a pane is a solid block, and the wheel opens it out.
                view={win.view}
                // The trim preview: what a cut at this gate would KEEP, while its menu is open.
                selection={keep ? { start: keep.from, end: keep.to } : null}
                // PINS inside the event, plain rules outside it: what lies past this window is context you can see and not material you can act on.
                markers={
                  editingOnsets
                    ? inAct.map((t) => ({ id: t.toFixed(4), atSec: t }))
                    : undefined
                }
                // Bubbles low on the line, not tabs along the top — a row of tabs covers the transients it points at.
                markerPlace="low"
                // The clip's stretch points, if it has a map: a dashed rule at the source moment, a blue one where its beat lands.
                warps={editingWarp ? wf.warpMarks : undefined}
                /** Double-click places a stretch point and dragging its handle says where it should land — one verb for both (clipWarp.ts). */
                onWarpAdd={
                  editingWarp && clip
                    ? (sec) =>
                        void run(
                          // The marks go WITH the map: the picture is piecewise, so inverting it needs the points and not just the ratio.
                          warpLine(
                            clip,
                            sec,
                            sec,
                            wf.sourceMap,
                            tempo,
                            wf.warpMarks,
                          ),
                          "warp",
                          true, // quiet: a marker inside one clip file changes nothing else
                        )
                    : undefined
                }
                /** …and a RIGHT-CLICK on a point is where removing it lives — the shell's own menu, addressed by the FILE second the mark carries. */
                onWarpMenu={
                  editingWarp && clip && onContextMenu
                    ? (mark, x, y) => {
                        const hit = wf.warpMarks.find(
                          (m) => Math.abs(m.orig - mark.orig) < 1e-9,
                        );
                        if (hit)
                          onContextMenu(
                            {
                              kind: "warp-point",
                              clip,
                              src: hit.src.toFixed(4),
                            },
                            x,
                            y,
                          );
                      }
                    : undefined
                }
                onWarpMove={
                  editingWarp && clip
                    ? (mark, to) =>
                        void run(
                          warpLine(
                            clip,
                            mark.orig,
                            to,
                            wf.sourceMap,
                            tempo,
                            wf.warpMarks,
                          ),
                          "warp",
                          true,
                        )
                    : undefined
                }
                // …and the onsets under them, as plain rules: reference, not pins — only the `onsets` view lets you touch them.
                onsets={
                  editingWarp ? onsets : editingOnsets ? outsideAct : undefined
                }
                // The EVENT's window, lit as ground with its edges picked out, and passed only when it actually cuts something.
                sourceWindow={framed ? act : null}
                /** …and its two edges DRAG, which is how an event's window is set — an `event …` verb, only where there is one to address (packages/song/docs/materialCut.md). */
                onWindowMove={
                  piece && takes
                    ? (w) => {
                        // Seconds into the take's file, back to song beats: where the piece's edges now fall.
                        const beat = (sec: number) =>
                          piece.start +
                          ((sec - (piece.sourceFrom ?? 0)) * tempo) / 60;
                        const lines = pieceEdgeLines(
                          takes.ev,
                          piece,
                          beat(w.from),
                          beat(w.to),
                          takes.num,
                          takes.den,
                        );
                        void (async () => {
                          for (const l of lines) await command(l);
                        })();
                      }
                    : eventAt && track
                      ? (w) =>
                          // A LOOPED event's window is its loop: moved the way the ruler's brace moves it, its length kept.
                          command(
                            `${looped ? "event loop points" : "event window"} ${track} ${eventAt} ${w.from.toFixed(4)} ${w.to.toFixed(4)}`,
                          )
                      : undefined
                }
                // A click on a mark refuses that onset, or takes a hand-placed one back — one verb, because from here it is one act.
                onMarkerClick={
                  editingOnsets
                    ? (m) =>
                        void run(
                          `clip onset remove ${clip} ${m.atSec.toFixed(4)}`,
                          `remove:${m.id}`,
                        )
                    : undefined
                }
                // …and dragging one MOVES it; dropped outside the event it is not an edit at all, rather than being silently clamped.
                onMarkerMove={
                  editingOnsets
                    ? (m, to) =>
                        inside(to) &&
                        void run(
                          `clip onset move ${clip} ${m.atSec.toFixed(4)} ${to.toFixed(4)}`,
                          `move:${m.id}`,
                        )
                    : undefined
                }
                // Anywhere else adds one — anywhere INSIDE the event; with the marks hidden the click is stowed with them.
                onSeek={
                  editingOnsets
                    ? (sec) =>
                        inside(sec) &&
                        void run(
                          `clip onset add ${clip} ${sec.toFixed(4)}`,
                          "add",
                        )
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
