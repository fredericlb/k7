// AudioClipPanel.tsx — ONE panel for an audio clip, whether it is being recorded or being worked
// on. While a take rolls it draws the envelope the engine is pushing, growing; the moment the
// recorder closes the file it draws that file instead, with its onsets, its threshold and the
// button that brings it up to level. Same waveform, same place, one view of one clip.

import { Button } from "@frediverse/ui/button";
import { useEngineState } from "@studio/engine-browser/store";
import { Waveform } from "@studio/ui-waveform";
import { Check, Loader2, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useLiveEnvelope } from "../hooks/useLiveEnvelope";
import type { WebWaveform } from "../types";

const WAVE_HEIGHT = 200; // a fixed band, so stopping does not resize the shell
const BUCKETS = 1200;
// The bounds the file service clamps to anyway (see the /waveform route) — repeated here so the
// slider cannot ask for something that comes back silently adjusted.
const SENS_MIN = 0.25;
const SENS_MAX = 8;

export function AudioClipPanel({
  clip,
  track,
  rolling,
  trackOrder,
  trackNames,
  command,
  onStop,
  onClose,
}: {
  /** The clip on screen — null while a take is rolling, since the file does not exist yet. */
  clip: string | null;
  track: string;
  /** Is a take being played right now? Decides which of the two pictures this draws. */
  rolling: boolean;
  /** The engine level index order, so an armed track maps to its inputLevels slot. */
  trackOrder: string[];
  /** Track id → display name, for naming who is being recorded. Which tracks those ARE comes off
   *  the engine store here, so the shell does not have to thread a second live value through. */
  trackNames: Record<string, string>;
  /** Runs a command line through the shell, which journals it — so every edit here is one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  onStop: () => void;
  onClose: () => void;
}) {
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined asks for whatever threshold the file was last built with; a number re-detects AND
  // remembers it in the sidecar, which is why moving the slider is a real edit and not a preview.
  const [sensitivity, setSensitivity] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
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
        onStop();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStop, rolling]);
  const armed = useEngineState((s) => s.armed);
  const armedNames = armed.map((id) => trackNames[id] ?? id);

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
  const seconds = (live.samples.length * live.intervalMs) / 1000;

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-1 bg-card/40 px-3 py-2"
      aria-label={rolling ? "prise en cours" : `clip ${clip ?? ""}`}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {rolling ? (
          <>
            <span className="text-sm uppercase tracking-wider text-red-400">
              Enregistrement
            </span>
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
      <div className="min-h-0 flex-1">
        {rolling ? (
          <Waveform
            envelope={live}
            duration={seconds}
            height={WAVE_HEIGHT}
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
            height={WAVE_HEIGHT}
            currentTime={0}
            // The project's bars and beats, straight from the same endpoint — WebWaveformGrid and
            // the canvas's WaveformGrid are the same three fields, so no translation is needed.
            gridLines={wf.grid}
            markers={onsets.map((t) => ({ id: t.toFixed(4), atSec: t }))}
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
