// TakeReview.tsx — the take you just recorded, once the transport stops: the FILE the service
// wrote, its waveform under the project's bar/beat ruler, the onsets over it as marks you can add
// and refuse, the threshold that finds them, and one button to bring it up to level. Sits in the
// column, beside RecordingPane's live view of the same take — see docs/shell.md on why both.

import { Button } from "@frediverse/ui/button";
import { Waveform } from "@studio/ui-waveform";
import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { WebWaveform } from "../types";

const WAVE_HEIGHT = 200; // a fixed band in the column, so stopping does not resize the shell
const BUCKETS = 1200;
// The bounds the file service clamps to anyway (see the /waveform route) — repeated here so the
// slider cannot ask for something that comes back silently adjusted.
const SENS_MIN = 0.25;
const SENS_MAX = 8;

export function TakeReview({
  clip,
  track,
  command,
  onClose,
}: {
  /** The clip the recorder just wrote — the id `clip onset …` and `clip normalize` name. */
  clip: string;
  track: string;
  /** Runs a command line through the shell, which journals it — so every edit here is one Ctrl+Z. */
  command: (line: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined asks for whatever threshold the file was last built with; a number re-detects AND
  // remembers it in the sidecar, which is why moving the slider is a real edit and not a preview.
  const [sensitivity, setSensitivity] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  // `whole`: the take is the file, and the onsets a command names are seconds into THAT — asking for
  // the placement's span would hand back seconds measured from a different zero.
  const load = useCallback(() => {
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
  // the onsets ARE rather than what the detector last thought. `wf.detected` carries the raw list for
  // anything that needs to tell the two apart; nothing here does, because removing means the same
  // thing either way (song/onsets.ts decides whether that is a refusal or an undone addition).
  const onsets = wf?.transients ?? [];

  return (
    <section
      className="flex shrink-0 flex-col gap-1 border-t border-border bg-card/40 px-3 py-2"
      aria-label={`prise ${clip}`}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{clip}</span>
        <span>sur {track}</span>
        <span className="text-muted-foreground/70">
          cliquer ajoute un onset · cliquer un repère l'enlève
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
          disabled={!!busy}
          onClick={() => void run(`clip normalize ${clip}`, "normalize")}
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
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="fermer"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error ? (
        <p className="py-6 text-center text-sm text-red-500">{error}</p>
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
          // The project's bars and beats, straight from the same endpoint — WebWaveformGrid and the
          // canvas's WaveformGrid are the same three fields, so the ruler needs no translation.
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
          // Anywhere else adds one. `onSeek` is the canvas's "you pointed at this second"; there is
          // nothing to seek on a take that is not playing, so this is what pointing means here.
          onSeek={(sec) =>
            void run(`clip onset add ${clip} ${sec.toFixed(4)}`, "add")
          }
        />
      )}
    </section>
  );
}
