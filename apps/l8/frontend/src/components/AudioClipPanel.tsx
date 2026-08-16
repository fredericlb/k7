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
import { cn } from "@frediverse/ui/lib/utils";
import { DEFAULT_TRIM_DB, trimWindow } from "@studio/commands/trim-gate";
import { useEngineState } from "@studio/engine-browser/store";
import { projectApi } from "@studio/project-shell/project";
import { wheelFactor } from "@studio/ui-timeline/panZoom";
import { Waveform } from "@studio/ui-waveform";
import { Check, Loader2, Play, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { anchorBars, barWindow, zoomBars } from "../barWindow";
import { useLiveEnvelope } from "../hooks/useLiveEnvelope";
import { barBeat, takeCounter } from "../takeCounter";
import type { TakeOption } from "../takeReview";
import type { WebWaveform } from "../types";
import { ArrangementRuler } from "./Ruler";

// The waveform fills whatever the panel has left under its header. Measured rather than guessed
// because `Waveform` draws a canvas, and a canvas needs its height in PIXELS — a percentage would
// stretch the drawing without telling it, which is the same class of bug as sizing its width in
// CSS. 120 is only the first, unmeasured frame.
const MIN_WAVE_H = 120;
const BUCKETS = 1200;
// The bounds the file service clamps to anyway (see the /waveform route) — repeated here so the
// slider cannot ask for something that comes back silently adjusted.
const SENS_MIN = 0.25;
const SENS_MAX = 8;

/**
 * The three ways of looking at a clip's wave. They differ in what is DRAWN over it and in what
 * pointing at it does — see `view` in the component.
 *
 * `warp` draws the onsets too, as plain grey rules: a stretch point is placed by dropping a beat
 * onto a hit, so the hits have to be visible while the warp marks are what the hand is on. They
 * are reference there, not pins — only `onsets` lets you touch them.
 */
type ClipMarkView = "standard" | "onsets" | "warp";
const CLIP_VIEWS: { value: ClipMarkView; label: string }[] = [
  { value: "standard", label: "standard" },
  { value: "onsets", label: "onsets" },
  { value: "warp", label: "warp" },
];
// The gate's range, in dBFS. −80 is below anything a take carries; −10 is above a signal, so the
// slider spans "keep almost everything" to "keep only what is loud" and neither end is useless.
const GATE_MIN = -80;
const GATE_MAX = -10;
/**
 * How many bars the waveform shows before you ask for more.
 *
 * A take is often minutes long, and a minute drawn across a pane is a solid block: the whole point
 * of looking at a take — where the attacks are, where the silence is, whether the onsets landed —
 * needs bars you can tell apart. Twelve is what a phrase tends to be, and it is the same choice
 * the recording window made when it showed eight.
 */
const DEFAULT_BARS = 12;
// Stable empty defaults: a fresh `[]` or `{}` per render is a new identity, and one of these feeds
// a memo — the same reason @studio/ui-waveform keeps its own.
const NO_TRACKS: string[] = [];
const NO_NAMES: Record<string, string> = {};
const NO_TAKES: TakeOption[] = [];
/** The token a library chain is named by — @studio/commands' MEDIATEK_CHAIN, which is not an
 *  export subpath. One word, and  refuses the ref without it. */
const MEDIATEK_CHAIN = "@st0/";
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function AudioClipPanel({
  clip,
  track,
  rolling = false,
  tempo = 120,
  beatsPerBar = 4,
  countIn = 0,
  startBeat = 0,
  trackOrder = NO_TRACKS,
  trackNames = NO_NAMES,
  placedAt = null,
  takes = NO_TAKES,
  onPickTake,
  onKeepTake,
  onPlay,
  onSeek,
  command,
  onStop,
  onClose,
}: {
  /** The clip on screen — null while a take is rolling, since the file does not exist yet. */
  clip: string | null;
  track: string;
  /**
   * Is a take being played right now? Decides which of the two pictures this draws.
   *
   * Everything from here down is the RECORDING half, and all of it is optional: opening this panel
   * on a clip that is simply sitting on a lane — a click on an audio event — has no take, no
   * count-in and no armed track to speak of. The file half needs none of them.
   */
  rolling?: boolean;
  tempo?: number;
  /** Quarter-note beats per bar (the project's time-sig numerator), for the counter AND for the
   *  twelve-bar window — so this one is worth passing even with no take in sight. */
  beatsPerBar?: number;
  /** Count-in length in BARS (0 == none) — the header counts it down before the take. */
  countIn?: number;
  /** The beat this take started on — the shell's, so the counter and the lane's growing clip agree. */
  startBeat?: number;
  /** The engine level index order, so an armed track maps to its inputLevels slot. */
  trackOrder?: string[];
  /** Track id → display name, for naming who is being recorded. Which tracks those ARE comes off
   *  the engine store here, so the shell does not have to thread a second live value through. */
  trackNames?: Record<string, string>;
  /** The arrangement beat where the clip's window PLAYS — what puts the song's ruler over the
   *  wave. Null for a clip nothing places, which has no position in the song to point at. */
  placedAt?: number | null;
  /**
   * Every version of this lane there is to listen to — its takes, then what it is playing.
   *
   * Empty for a lane with no takes, which is the ordinary case and draws no sidebar: a choice
   * of one is a column of nothing. See takeReview.ts and packages/song/docs/takes.md.
   */
  takes?: TakeOption[];
  /** Put a take on the track and review it. A SWAP, so what was playing becomes that take. */
  onPickTake?: (take: TakeOption) => void | Promise<void>;
  /** Keep what the track is playing and delete every take — the end of choosing. */
  onKeepTake?: () => void;
  /** Start or stop the transport, so a take can be auditioned without leaving the panel. */
  onPlay?: () => void;
  /** Seek the transport, in SONG seconds — what a click on that ruler does. */
  onSeek?: (seconds: number) => void;
  /** Runs a command line through the shell, which journals it — so every edit here is one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  /** Stop the take. Absent when there is no take to stop — a clip opened from the timeline. */
  onStop?: () => void;
  onClose: () => void;
}) {
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined asks for whatever threshold the file was last built with; a number re-detects AND
  // remembers it in the sidecar, which is why moving the slider is a real edit and not a preview.
  const [sensitivity, setSensitivity] = useState<number | undefined>(undefined);
  /**
   * The chains this clip can be run through, as `clip process` names them. Fetched once when the
   * panel opens: the list changes when somebody edits the library, which is not something to poll.
   */
  const [chains, setChains] = useState<string[] | null>(null);
  const [opSearch, setOpSearch] = useState("");
  useEffect(() => {
    let live = true;
    projectApi
      .libraryChains()
      .then(
        (r) =>
          live && setChains(r.chains.map((c) => `${MEDIATEK_CHAIN}${c.ref}`)),
      )
      .catch(() => live && setChains([]));
    return () => {
      live = false;
    };
  }, []);
  // Filtered on the whole ref, so typing  finds  wherever the word
  // sits — a chain is filed by path, and nobody remembers which folder it went in.
  const ops = useMemo(
    () =>
      (chains ?? []).filter((c) =>
        c.toLowerCase().includes(opSearch.trim().toLowerCase()),
      ),
    [chains, opSearch],
  );

  const [busy, setBusy] = useState<string | null>(null);
  // The trim gate, in dBFS, and whether its menu is open. Open is what draws the preview, so the
  // two travel together: a gate nobody is looking at should not paint over the take.
  const [gate, setGate] = useState(DEFAULT_TRIM_DB);
  const [gateOpen, setGateOpen] = useState(false);
  // The window the person asked for: how many bars, and from which bar. State and not a derived
  // value, because it is a thing they chose — it must survive the re-read every edit triggers —
  // and ONE state, because a zoom about the cursor writes a new width and a new start together.
  const [asked, setAsked] = useState({ bars: DEFAULT_BARS, start: 0 });
  // Off by default: the marks are an editing layer, and opening a clip is first of all LOOKING at
  // it. Hiding them also stows their verbs — a click must not add an onset nobody can see.
  /**
   * What the picture is FOR right now — and so what it draws and what a click means.
   *
   * One control rather than a pile of toggles, because the three answers are exclusive in
   * practice: onsets and stretch points are both vertical rules over the same wave, and shown
   * together neither reads. It also settles what a click does, which a checkbox could not: in
   * `onsets` the canvas is an onset editor, everywhere else pointing at it means nothing.
   */
  const [view, setView] = useState<ClipMarkView>("standard");
  const editingOnsets = view === "onsets";
  const editingWarp = view === "warp";
  // The box the waveform fills, measured. See MIN_WAVE_H. The width came along for the
  // arrangement ruler, which needs pixels-per-beat before it can draw a tick.
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
  // Esc stops the take, captured so it reads as "leave the take" wherever the pointer went. Bound
  // only while one is ROLLING: once it is over this panel is a clip you are working on, and Escape
  // belongs to the shell again. It skips a field being typed in — a capture-phase listener without
  // that check eats the Escape that closes the command bar.
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
  const armed = useEngineState((s) => s.armed);
  const armedNames = armed.map((id) => trackNames[id] ?? id);
  const playing = useEngineState((s) => s.playing);
  // A pick is a command and a reload, so the list is held while one is in flight — two clicks
  // racing would swap twice and leave a take somewhere neither click asked for.
  const [picking, setPicking] = useState<number | null>(null);
  // The list is only worth drawing once there is a CHOICE, which is what more than one recorded
  // pass means. `takeOptions` already answers empty for a lane with no takes.
  const sidebar = !rolling && takes.length > 0;

  // The transport's position in beats. Re-renders on whole beats only — the header counts beats,
  // and one that re-rendered on every 20 Hz frame would redraw the waveform beside it.
  const curBeat = useEngineState((s) =>
    Math.floor((s.playhead * tempo) / 60 + 1e-6),
  );
  // `startBeat` arrives from the shell, taken on the rolling edge. The pane this replaces captured
  // it once per MOUNT and then outlived its take, so every take after the first was measured
  // against the first one's start — the whole bug, see takeCounter.ts. It is a prop rather than a
  // second capture because the lane draws the growing clip from the same number.
  const count = takeCounter(startBeat, curBeat, countIn * beatsPerBar);
  /**
   * The count-in is not the take: nothing is recorded during it, so nothing is drawn — and
   * nothing is COLLECTED either.
   *
   * The envelope clears on the edge its flag goes true, so handing it `rolling` made it start
   * at the transport rather than at the first recorded sample: the picture then opened with
   * however many bars of click and room the pre-roll lasted, and everything after it sat that
   * far to the right of where it is in the file. `recording` is the honest edge.
   */
  const counting = rolling && count.phase === "count-in";
  const live = useLiveEnvelope(rolling && !counting, trackOrder);
  // No "how long it ran" kept once it stops: the panel switches to the FILE the moment the take is
  // over, and the file's own length is the honest answer to that. The old pane had to remember it
  // because it stayed on the live picture, whose playhead jumps back where the transport left it.
  const at = barBeat(count.beats, beatsPerBar);

  // `whole`: the take is the file, and the onsets a command names are seconds into THAT — asking
  // for the placement's span would hand back seconds measured from a different zero.
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
  useEffect(load, [load]);

  // Every edit is a command, and every command is followed by a re-read: the file service resolves
  // the corrections into `transients`, so what comes back IS the answer rather than this component's
  // guess at it. Serialised through `busy` so a double-click cannot race two writes onto one file.
  const run = async (line: string, label: string) => {
    if (busy) return;
    setBusy(label);
    try {
      await command(line);
      load();
    } finally {
      setBusy(null);
    }
  };

  // The corrected set — the file service has already applied the clip's corrections, so this is what
  // the onsets ARE rather than what the detector last thought.
  const onsets = wf?.transients ?? [];
  /**
   * The interval the clip PLAYS — its `from`/`to`, or the whole file when it states none. The
   * panel is caged to it: what lies outside is not drawn, not zoomable-to, not clickable. Guarded
   * against a window the file outgrew (a `to` past the audio) by clamping, and against one that
   * does not run forwards by falling back to the whole file.
   */
  const span = useMemo(() => {
    const dur = wf?.seconds ?? 0;
    const sw = wf?.sourceWindow;
    const from = clamp(sw?.from ?? 0, 0, dur);
    const to = clamp(sw?.to ?? dur, 0, dur);
    return to > from ? { from, to } : { from: 0, to: dur };
  }, [wf]);
  /**
   * What a trim at this gate would KEEP — the preview, drawn as a selection over the wave.
   *
   * The SAME function the command runs (`trimWindow`), not a second implementation of it: a
   * preview that disagreed with the act would be worse than no preview. It reads the envelope the
   * panel already has, which is the same source the service gates on, so the only difference
   * between the two is bucket resolution. Bounded to `span` exactly as the command bounds itself
   * to the clip's window — a re-trim refines, it never reaches back.
   */
  const keep = useMemo(
    () => (gateOpen && wf ? trimWindow(wf.rms, wf.seconds, gate, span) : null),
    [gateOpen, wf, gate, span],
  );
  const seconds = (live.samples.length * live.intervalMs) / 1000;
  // The window on the clip's interval: `asked.bars` bars from `asked.start`. The maths and its
  // edges — a part-bar interval, a tempo that has not arrived — live in barWindow.ts.
  const win = barWindow(span, asked.bars, tempo, beatsPerBar, asked.start);
  // Beats per second — the whole of the conversion, since there is no tempo map.
  const bps = Math.max(1e-6, tempo / 60);

  /**
   * Zoom about a point: the new width, anchored so the moment under `clientX` stays where it is —
   * the promise the arrangement panes make through `useHZoom`, restated for a pane that draws a
   * view span instead of scrolling. `nextBars` reads the CURRENT window through the updater, so a
   * pinch's stream of events composes instead of racing one stale value.
   */
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
        const cur = barWindow(span, a.bars, tempo, beatsPerBar, a.start);
        const next = clamp(
          nextBars({ bars: cur.shown, allBars: cur.allBars }),
          1,
          cur.allBars,
        );
        return {
          bars: next,
          start: anchorBars(cur.view, frac, next, cur.barSec, span.from),
        };
      });
    },
    [span, tempo, beatsPerBar],
  );

  // What is shown RIGHT NOW, for the pinch to measure from: the gesture outlives any render, so
  // its baseline cannot live in the effect's closure — re-binding mid-pinch would drop the fingers.
  const shownRef = useRef(win.shown);
  shownRef.current = win.shown;

  /**
   * Two fingers on the wave, where there is no wheel at all — the same gesture and the same
   * measured-from-the-start arithmetic as `useHZoom`'s pinch, bound natively because React's
   * touch listeners are passive and could not hold the browser's own gesture off. Fingers apart
   * narrows the window (zoom in); the anchor is the centre of the two touches.
   */
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
    <section
      className="flex h-full min-h-0 flex-col gap-1 bg-card/40 px-3 py-2"
      aria-label={rolling ? "prise en cours" : `clip ${clip ?? ""}`}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {rolling ? (
          <>
            {/* The pre-roll counts DOWN, then the take counts up in bar:beat. Two states of one
                counter, and the take's own — measured from where this take started, not from the
                song's bar one. */}
            {count.phase === "count-in" ? (
              <>
                <span className="text-sm uppercase tracking-wider text-muted-foreground">
                  Décompte
                </span>
                <span className="font-mono text-2xl tabular-nums text-red-400">
                  {count.beats}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm uppercase tracking-wider text-red-400">
                  Enregistrement
                </span>
                <span className="font-mono text-2xl tabular-nums">
                  {at.bar}:{at.beat}
                </span>
              </>
            )}
            <span className="truncate">
              {armedNames.length
                ? armedNames.join(", ")
                : "aucune piste armée — armez-en une avec A / r"}
            </span>
            <span className="font-mono tabular-nums">
              {seconds.toFixed(1)} s
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={onStop}
              title="Arrêter la prise (Échap)"
            >
              <Square className="mr-1 h-3 w-3" /> Stop
            </Button>
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{clip}</span>
            {/* A clip nothing places has no lane to name — a take whose placement was never
                written, or was deleted while its file stayed in clips/. It works the same: the
                waveform, the onsets and the level belong to the FILE. */}
            {track ? <span>sur {track}</span> : <span>hors piste</span>}
            {editingOnsets && (
              <span className="text-muted-foreground/70">
                cliquer ajoute un onset · glisser un repère le déplace · cliquer
                l'enlève
              </span>
            )}
            {editingWarp && (
              <span className="text-muted-foreground/70">
                les traits gris sont les onsets, en repère — clip warp pose les
                points d'étirement
              </span>
            )}
            {/* What is on screen, and the way back to the whole take. Said out loud because a
                window that showed only the first bars without saying so would read as a clip that
                had been cut. */}
            {wf && win.allBars > 1 && (
              <span className="whitespace-nowrap tabular-nums">
                {Math.round(win.shown)}/{win.allBars} mes.
                {win.shown < win.allBars && (
                  <button
                    type="button"
                    className="ml-1 underline hover:text-foreground"
                    onClick={() => setAsked({ bars: win.allBars, start: 0 })}
                  >
                    tout
                  </button>
                )}
              </span>
            )}

            {/* What the picture is for. Native `<select>` like the sliders beside it — this
                toolbar is plain controls, and a styled menu here would be the odd one out. */}
            <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
              vue
              <select
                className="rounded border border-input bg-background px-1 py-0.5"
                value={view}
                onChange={(e) => setView(e.target.value as ClipMarkView)}
                aria-label="type de vue"
              >
                {CLIP_VIEWS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            {/* The threshold belongs to the onset editor: it is what re-detects the very marks
                you are correcting. In `warp` the rules are a backdrop, and a slider that
                silently rewrote the sidecar under a stretch job would be a trap. */}
            {editingOnsets && (
              <label className="flex items-center gap-2">
                seuil
                <input
                  type="range"
                  min={SENS_MIN}
                  max={SENS_MAX}
                  step={0.25}
                  value={sensitivity ?? 2}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-32"
                  aria-label="sensibilité de détection des onsets"
                />
                <span className="w-8 tabular-nums">
                  {(sensitivity ?? 2).toFixed(2)}
                </span>
              </label>
            )}

            {/* Trim: a button that OPENS a gate rather than applying one, because where the
                silence ends is a judgement and the waveform is what you judge it on. While the
                menu is open the part that would be KEPT is drawn as a selection over the wave, so
                the slider is read against the take instead of against a number. */}
            <DropdownMenu
              open={gateOpen}
              onOpenChange={(o) => setGateOpen(o && !!clip)}
            >
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!busy || !clip}>
                  {busy === "trim" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "rogner"
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-3">
                <div className="flex items-center gap-2 text-xs">
                  seuil
                  <input
                    type="range"
                    min={GATE_MIN}
                    max={GATE_MAX}
                    step={1}
                    value={gate}
                    onChange={(e) => setGate(Number(e.target.value))}
                    className="flex-1"
                    aria-label="seuil de rognage en dBFS"
                  />
                  <span className="w-12 tabular-nums">{gate} dB</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {keep
                    ? `garde ${keep.from.toFixed(2)}s → ${keep.to.toFixed(2)}s`
                    : "rien au-dessus de ce seuil"}
                </p>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={!keep || !!busy}
                  onClick={() => {
                    setGateOpen(false);
                    if (clip) void run(`clip trim ${clip} ${gate}`, "trim");
                  }}
                  title="déplace la fenêtre du clip — l'audio n'est pas touché"
                >
                  rogner
                </Button>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Operations: every chain the project and the library offer, run over THIS clip.
                It replaced a lone "normaliser" button — normalising is one treatment among many,
                and the médiathèque already ships it as a chain (see @studio/commands
                docs/processChain.md). The render lands beside the source, stamped, and the clip
                is repointed at it: that half is 's and is not redone here. */}
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
                <input
                  value={opSearch}
                  onChange={(e) => setOpSearch(e.target.value)}
                  placeholder="chercher une chaîne…"
                  // Not autofocused: the menu takes the focus itself, and stealing it back
                  // breaks the arrow keys the list is navigated with.
                  className="mb-1 w-full rounded border bg-transparent px-2 py-1 text-xs outline-none"
                />
                <div className="max-h-64 overflow-auto">
                  {ops.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {chains === null ? "…" : "aucune chaîne"}
                    </p>
                  ) : (
                    ops.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          clip &&
                          void run(`clip process ${clip} ${c}`, "process")
                        }
                        className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                      >
                        {c}
                      </button>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={onClose} title="terminé">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="fermer"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* The take list beside the wave, and the wave itself. One row when there is nothing to
          choose between; two columns the moment a recording left several passes behind. */}
      <div className="flex min-h-0 flex-1 gap-2">
        {sidebar && (
          /**
           * Every version of this lane, oldest slot first, with what it is PLAYING last.
           *
           * Clicking one is a `track take select`: it goes onto the track, so what you are
           * looking at and what you would HEAR are the same take — with the rest of the band,
           * which is the whole reason it goes onto the track rather than being previewed alone.
           * The swap is reversible and loses nothing, so auditioning costs nothing either.
           */
          <aside
            className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border pr-2 text-xs"
            aria-label="prises"
          >
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="uppercase tracking-wider">prises</span>
              {onPlay && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={onPlay}
                  title={
                    playing
                      ? "arrêter"
                      : "écouter à partir du début de cette prise"
                  }
                  aria-label={playing ? "arrêter" : "écouter"}
                >
                  {playing ? (
                    <Square className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>
            {takes.map((t) => {
              const here = t.n === null;
              const at = barBeat(t.startBeat, beatsPerBar);
              return (
                <button
                  key={t.n ?? "playing"}
                  type="button"
                  disabled={picking !== null}
                  onClick={() => {
                    // The playing one is already where it needs to be: the click just puts the
                    // playhead at its start, which is what makes ▶ mean "hear this take".
                    if (here || !onPickTake) {
                      onSeek?.((t.startBeat * 60) / tempo);
                      return;
                    }
                    setPicking(t.n);
                    void Promise.resolve(onPickTake(t)).finally(() =>
                      setPicking(null),
                    );
                  }}
                  className={cn(
                    "flex flex-col items-start rounded px-2 py-1 text-left hover:bg-accent",
                    here &&
                      "bg-primary/15 outline outline-1 outline-primary/50",
                    picking !== null && "opacity-60",
                  )}
                  title={
                    here
                      ? `sur la piste — mesure ${at.bar}`
                      : `écouter la prise ${t.n} — elle passe sur la piste, l'actuelle devient la prise ${t.n}`
                  }
                >
                  <span
                    className={cn(
                      "font-medium",
                      here ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t.name ?? (here ? "sur la piste" : `prise ${t.n}`)}
                  </span>
                  <span className="w-full truncate text-[10px] text-muted-foreground">
                    {t.events === 0
                      ? "vide"
                      : `${t.clip}${t.events > 1 ? ` +${t.events - 1}` : ""}`}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">
                    mes. {at.bar}:{at.beat}
                  </span>
                </button>
              );
            })}
            {/* The decision. It keeps whatever is ON the track — which is the take you last
                clicked — so the button says the choice rather than naming a number again. */}
            {onKeepTake && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-1 shrink-0"
                disabled={picking !== null}
                onClick={onKeepTake}
                title="garder la prise qui est sur la piste et supprimer toutes les autres"
              >
                garder celle-ci
              </Button>
            )}
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          {/* The SONG's ruler over the wave — the same ticks the timeline draws (Ruler.tsx), offset
          to where this window plays in the arrangement, and a click seeks the transport there.
          Beats derive through the one tempo, exact for an unwarped clip; a stretch map bends
          time INSIDE the clip and this strip stays the placement's grid — the frame, not the
          warp. Hidden while a take rolls (its position is the counter's business) and for a
          clip nothing places, which has no position in the song to point at. */}
          {!rolling &&
            wf &&
            placedAt != null &&
            waveW > 0 &&
            win.view.end > win.view.start && (
              <ArrangementRuler
                startBeat={placedAt + (win.view.start - span.from) * bps}
                beats={(win.view.end - win.view.start) * bps}
                ppb={waveW / ((win.view.end - win.view.start) * bps)}
                barBeats={beatsPerBar}
                tempo={tempo}
                height={18}
                onSeek={onSeek}
                className="shrink-0 border-b border-border/50 font-mono text-[10px] text-muted-foreground"
              />
            )}
          {/* Two pictures, one frame. Rolling: what the engine is hearing, appended as it arrives and
          with nothing to edit on it — there is no file yet to carry an onset. Stopped: the file
          the service wrote, which is the one that can be marked up. */}
          {/* The wheel zooms the window, out as readily as in, ANCHORED under the cursor — the same
          promise the timeline and the roll make. A notch takes zoomBars' step; a trackpad pinch
          arrives as Ctrl+wheel, a stream of small deltas, and scales continuously (wheelFactor —
          see @studio/ui-timeline/panZoom for why the two cannot share an answer).
          `passive: false` is not needed: React's onWheel is passive-by-default only on the window,
          and this is an element listener, so preventDefault holds and the pane does not scroll.
          touch-none because the two-finger pinch above is ours, and nothing here scrolls. */}
          <div
            ref={waveBox}
            className="min-h-0 flex-1 touch-none"
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
              // Nothing is being recorded yet, so there is nothing to draw: an envelope here would be
              // the room and the click, growing, and then the take would appear to start that far in.
              // The header is already counting the pre-roll down.
              <p className="py-6 text-center text-sm text-muted-foreground">
                décompte — la prise commence après
              </p>
            ) : rolling ? (
              <Waveform
                envelope={live}
                duration={seconds}
                height={waveH}
                currentTime={seconds}
              />
            ) : error ? (
              <p className="py-6 text-center text-sm text-red-500">{error}</p>
            ) : !clip ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                aucune prise — lancez le transport avec l'enregistrement armé
              </p>
            ) : !wf ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                lecture de la prise…
              </p>
            ) : (
              <Waveform
                envelope={{ intervalMs: wf.intervalMs, samples: wf.rms }}
                duration={wf.seconds}
                height={waveH}
                currentTime={0}
                // The project's bars and beats, straight from the same endpoint — WebWaveformGrid and
                // the canvas's WaveformGrid are the same three fields, so no translation is needed.
                gridLines={wf.grid}
                // Twelve bars by default — a minute of take drawn across a pane is a solid block, and
                // what you came to look at is where the attacks are. The wheel opens it out.
                view={win.view}
                // The trim preview: what a cut at this gate would KEEP, while its menu is open.
                selection={keep ? { start: keep.from, end: keep.to } : null}
                markers={
                  editingOnsets
                    ? onsets.map((t) => ({ id: t.toFixed(4), atSec: t }))
                    : undefined
                }
                // Bubbles low on the line, not tabs along the top: the top of a waveform is where the
                // loud material is, and a row of tabs there covers the transients it points at.
                markerPlace="low"
                // The clip's stretch points, if it has a map: a dashed rule at the moment of the
                // source, a blue one where that moment's beat lands. `clip warp` is what moves them.
                warps={editingWarp ? wf.warpMarks : undefined}
                // …and the onsets under them, as plain rules. A stretch point is placed by
                // dropping a beat onto a hit, so the hits have to be on screen — as reference,
                // not as pins: only the `onsets` view lets you touch them.
                onsets={editingWarp ? onsets : undefined}
                // No `sourceWindow` band: the view is CAGED to the clip's `from`/`to` (see `span`), so
                // the window is the whole picture rather than a span inside it — a band would tint
                // everything and mark nothing.
                sourceWindow={null}
                // A click on a mark refuses that onset; on a detected one that records a removal, on a
                // hand-placed one it takes the addition back — one verb, because from here it is one act.
                onMarkerClick={
                  editingOnsets
                    ? (m) =>
                        void run(
                          `clip onset remove ${clip} ${m.atSec.toFixed(4)}`,
                          `remove:${m.id}`,
                        )
                    : undefined
                }
                // …and dragging one MOVES it: the detector heard the attack a hair late, and saying
                // where it belongs is one act, not a refusal followed by an addition.
                onMarkerMove={
                  editingOnsets
                    ? (m, to) =>
                        void run(
                          `clip onset move ${clip} ${m.atSec.toFixed(4)} ${to.toFixed(4)}`,
                          `move:${m.id}`,
                        )
                    : undefined
                }
                // Anywhere else adds one. `onSeek` is the canvas's "you pointed at this second"; there
                // is nothing to seek on a take that is not playing, so this is what pointing means here.
                // Marks hidden, the click is stowed with them — no invisible onsets.
                onSeek={
                  editingOnsets
                    ? (sec) =>
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
