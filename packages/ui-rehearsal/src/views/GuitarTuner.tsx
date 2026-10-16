import { Button } from "@frediverse/ui/button";
import { Mic, MicOff, Square } from "@frediverse/ui/icons";
import { acquireMicrophone, describeMicError } from "@studio/recorder";
import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { m } from "../paraglide/messages.js";
import { micErrors } from "../recorderLabels";
import { freqToNote, GUITAR_STRINGS, nearestString } from "../utils/pitch";

interface Props {
  onBack: () => void;
}

interface Reading {
  freq: number;
  name: string;
  octave: number;
  cents: number;
}

// A pluck is "in tune" once it's within this many cents of the note.
const IN_TUNE_CENTS = 5;
// The display follows the pitch at about 20 Hz: the eye reads no faster, and every update re-renders the tuner.
const SHOW_EVERY_MS = 50;

/** A live tuner: the mic, a pitch by autocorrelation, and the nearest string. */
export function GuitarTuner({ onBack }: Props) {
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    setReading(null);
  };

  const start = async () => {
    // One start at a time: a double click would open a second stream the first stop never sees.
    if (starting.current || streamRef.current) return;
    starting.current = true;
    setError(null);
    try {
      const stream = await acquireMicrophone();
      // Left the tuner while the permission prompt was up: stop it here, since stop() already ran.
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      // Started outside a gesture on some browsers, the analyser would read silence.
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const detector = PitchDetector.forFloat32Array(analyser.fftSize);
      setRunning(true);

      // Hold the last confident reading, so the display does not blank between plucks.
      let lastPitchAt = 0;
      // What the display shows, and when it last changed: it moves at most SHOW_EVERY_MS apart, and only when the text would.
      let shown = "";
      let shownAt = 0;
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const [freq, clarity] = detector.findPitch(buf, ctx.sampleRate);
        const now = performance.now();
        // Gate on clarity and the guitar's range, so noise and harmonics cannot jump the needle.
        if (clarity > 0.9 && freq > 60 && freq < 1400) {
          lastPitchAt = now;
          const n = freqToNote(freq);
          const key = `${n.name}${n.octave}:${n.cents}:${freq.toFixed(1)}`;
          if (key !== shown && now - shownAt >= SHOW_EVERY_MS) {
            shown = key;
            shownAt = now;
            setReading({
              freq,
              name: n.name,
              octave: n.octave,
              cents: n.cents,
            });
          }
        } else if (now - lastPitchAt > 800 && shown !== "") {
          shown = "";
          setReading(null);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setError(describeMicError(err, micErrors()));
      stop();
    } finally {
      starting.current = false;
    }
  };

  const alive = useRef(true);
  const starting = useRef(false);
  // Release the mic + audio graph when leaving the tuner.
  useEffect(() => {
    // Set again on every mount: StrictMode runs mount, cleanup, mount on the SAME instance.
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, []);

  const inTune = reading != null && Math.abs(reading.cents) <= IN_TUNE_CENTS;
  // Map −50..+50 cents onto 0..100% of the meter width.
  const needlePct = reading
    ? 50 + Math.max(-50, Math.min(50, reading.cents))
    : 50;
  const target = reading ? nearestString(reading.freq) : null;

  return (
    <div className="exercise tuner">
      <div className="detail-head">
        <BackButton to={m["nav.exercices"]()} onClick={onBack} />
        <h2>{m["exercise.tuner.title"]()}</h2>
      </div>
      <p className="muted small">{m["exercise.tuner.help"]()}</p>

      {error && (
        <p className="error">
          <MicOff className="size-3.5" /> {error}
        </p>
      )}

      {!running ? (
        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={start}>
            <Mic className="size-4" /> {m["exercise.tuner.start"]()}
          </Button>
        </div>
      ) : (
        <>
          <div className={`tuner-note${inTune ? " in-tune" : ""}`}>
            {reading ? (
              <>
                <span className="tuner-note-name">
                  {reading.name}
                  <span className="tuner-note-oct">{reading.octave}</span>
                </span>
                <span className="tuner-cents">
                  {m["exercise.tuner.cents"]({
                    cents:
                      reading.cents > 0
                        ? `+${reading.cents}`
                        : `${reading.cents}`,
                  })}
                </span>
              </>
            ) : (
              <span className="muted">{m["exercise.tuner.listening"]()}</span>
            )}
          </div>

          <div className="tuner-meter">
            <div className="tuner-meter-scale">
              <span>♭</span>
              <span>{m["exercise.tuner.inTune"]()}</span>
              <span>♯</span>
            </div>
            <div className="tuner-meter-bar">
              <div className="tuner-meter-center" />
              <div
                className={`tuner-needle${inTune ? " in-tune" : ""}`}
                style={{ left: `${needlePct}%` }}
              />
            </div>
          </div>

          <div className="tuner-strings">
            {GUITAR_STRINGS.map((s) => (
              <span
                key={s.label}
                className={`tuner-string${
                  target?.label === s.label ? " active" : ""
                }`}
                title={`${s.label} · ${s.freq.toFixed(2)} Hz`}
              >
                {s.note}
              </span>
            ))}
          </div>

          {reading && (
            <p className="muted small tuner-freq">
              {reading.freq.toFixed(1)} Hz
              {target
                ? ` · ${m["exercise.tuner.nearest"]({ string: target.label, freq: target.freq.toFixed(1) })}`
                : ""}
            </p>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="outline" onClick={stop}>
              <Square className="size-4" /> {m["common.stop"]()}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
