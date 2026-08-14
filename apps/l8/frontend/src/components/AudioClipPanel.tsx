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
import { DEFAULT_TRIM_DB, trimWindow } from "@studio/commands/trim-gate";
import { useEngineState } from "@studio/engine-browser/store";
import { Waveform } from "@studio/ui-waveform";
import { Check, Loader2, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { barWindow, zoomBars } from "../barWindow";
import { useLiveEnvelope } from "../hooks/useLiveEnvelope";
import { barBeat, takeCounter } from "../takeCounter";
import type { WebWaveform } from "../types";

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
  const [busy, setBusy] = useState<string | null>(null);
  // The trim gate, in dBFS, and whether its menu is open. Open is what draws the preview, so the
  // two travel together: a gate nobody is looking at should not paint over the take.
  const [gate, setGate] = useState(DEFAULT_TRIM_DB);
  const [gateOpen, setGateOpen] = useState(false);
  // How many bars are on screen. State and not a derived value, because it is a thing the person
  // asked for: zooming out to see the whole take must survive the re-read every edit triggers.
  const [bars, setBars] = useState(DEFAULT_BARS);
  // The box the waveform fills, measured. See MIN_WAVE_H.
  const waveBox = useRef<HTMLDivElement>(null);
  const [waveH, setWaveH] = useState(MIN_WAVE_H);
  useEffect(() => {
    const el = waveBox.current;
    if (!el) return;
    const ro = new ResizeObserver((e) =>
      setWaveH(Math.max(MIN_WAVE_H, Math.floor(e[0].contentRect.height))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const live = useLiveEnvelope(rolling, trackOrder);

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
   * What a trim at this gate would KEEP — the preview, drawn as a selection over the wave.
   *
   * The SAME function the command runs (`trimWindow`), not a second implementation of it: a
   * preview that disagreed with the act would be worse than no preview. It reads the envelope the
   * panel already has, which is the same source the service gates on, so the only difference
   * between the two is bucket resolution.
   */
  const keep = useMemo(
    () => (gateOpen && wf ? trimWindow(wf.rms, wf.seconds, gate) : null),
    [gateOpen, wf, gate],
  );
  const seconds = (live.samples.length * live.intervalMs) / 1000;
  // The window on the file: the first `bars` bars, or the whole take when it is shorter. The maths
  // and its edges — a part-bar take, a tempo that has not arrived — live in barWindow.ts.
  const win = barWindow(wf?.seconds ?? 0, bars, tempo, beatsPerBar);

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
            <span className="text-muted-foreground/70">
              cliquer ajoute un onset · glisser un repère le déplace · cliquer
              l'enlève
            </span>
            {/* What is on screen, and the way back to the whole take. Said out loud because a
                window that showed only the first bars without saying so would read as a clip that
                had been cut. */}
            {wf && win.allBars > 1 && (
              <span className="whitespace-nowrap tabular-nums">
                {win.shown}/{win.allBars} mes.
                {win.shown < win.allBars && (
                  <button
                    type="button"
                    className="ml-1 underline hover:text-foreground"
                    onClick={() => setBars(win.allBars)}
                  >
                    tout
                  </button>
                )}
              </span>
            )}

            <label className="ml-auto flex items-center gap-2">
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
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || !clip}
              onClick={() =>
                clip && void run(`clip normalize ${clip}`, "normalize")
              }
              title="amener le fichier à −1 dBFS, sur place (annulable)"
            >
              {busy === "normalize" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "normaliser"
              )}
            </Button>
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

      {/* Two pictures, one frame. Rolling: what the engine is hearing, appended as it arrives and
          with nothing to edit on it — there is no file yet to carry an onset. Stopped: the file
          the service wrote, which is the one that can be marked up. */}
      {/* The wheel zooms the window, out as readily as in — the ask was a default, not a ceiling.
          `passive: false` is not needed: React's onWheel is passive-by-default only on the window,
          and this is an element listener, so preventDefault holds and the pane does not scroll. */}
      <div
        ref={waveBox}
        className="min-h-0 flex-1"
        onWheel={(e) => {
          if (rolling || !wf) return;
          e.preventDefault();
          setBars((b) => zoomBars(b, e.deltaY, win.allBars));
        }}
      >
        {rolling ? (
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
            markers={onsets.map((t) => ({ id: t.toFixed(4), atSec: t }))}
            // Bubbles low on the line, not tabs along the top: the top of a waveform is where the
            // loud material is, and a row of tabs there covers the transients it points at.
            markerPlace="low"
            // A click on a mark refuses that onset; on a detected one that records a removal, on a
            // hand-placed one it takes the addition back — one verb, because from here it is one act.
            onMarkerClick={(m) =>
              void run(
                `clip onset remove ${clip} ${m.atSec.toFixed(4)}`,
                `remove:${m.id}`,
              )
            }
            // …and dragging one MOVES it: the detector heard the attack a hair late, and saying
            // where it belongs is one act, not a refusal followed by an addition.
            onMarkerMove={(m, to) =>
              void run(
                `clip onset move ${clip} ${m.atSec.toFixed(4)} ${to.toFixed(4)}`,
                `move:${m.id}`,
              )
            }
            // Anywhere else adds one. `onSeek` is the canvas's "you pointed at this second"; there
            // is nothing to seek on a take that is not playing, so this is what pointing means here.
            onSeek={(sec) =>
              void run(`clip onset add ${clip} ${sec.toFixed(4)}`, "add")
            }
          />
        )}
      </div>
    </section>
  );
}
