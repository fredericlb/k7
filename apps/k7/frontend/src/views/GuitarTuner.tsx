import { Button } from "@frediverse/ui/button";
import { acquireMicrophone, describeMicError } from "@k7/recorder";
import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";
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

/**
 * A live guitar tuner: reads the microphone, estimates the played pitch via
 * autocorrelation, and shows the note, cents deviation, a needle meter and the
 * nearest standard-tuning string. There's nothing to score — it just listens.
 */
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
    setError(null);
    try {
      const stream = await acquireMicrophone();
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      // Auto-started outside a gesture on some browsers — resume so the
      // analyser reads real audio rather than silence.
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const detector = PitchDetector.forFloat32Array(analyser.fftSize);
      setRunning(true);

      // Hold the last confident reading briefly so the display doesn't blank
      // out in the gaps between plucks.
      let lastPitchAt = 0;
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const [freq, clarity] = detector.findPitch(buf, ctx.sampleRate);
        const now = performance.now();
        // Gate on pitchy's clarity score and the guitar's frequency range so
        // noise and octave/harmonic glitches don't jump the display around.
        if (clarity > 0.9 && freq > 60 && freq < 1400) {
          const n = freqToNote(freq);
          setReading({ freq, name: n.name, octave: n.octave, cents: n.cents });
          lastPitchAt = now;
        } else if (now - lastPitchAt > 800) {
          setReading(null);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setError(describeMicError(err));
      stop();
    }
  };

  // Release the mic + audio graph when leaving the tuner.
  useEffect(() => stop, []);

  const inTune = reading != null && Math.abs(reading.cents) <= IN_TUNE_CENTS;
  // Map −50..+50 cents onto 0..100% of the meter width.
  const needlePct = reading
    ? 50 + Math.max(-50, Math.min(50, reading.cents))
    : 50;
  const target = reading ? nearestString(reading.freq) : null;

  return (
    <div className="exercise tuner">
      <Button variant="outline" size="sm" onClick={onBack}>
        ← Exercices
      </Button>
      <h2>Guitar tuner</h2>
      <p className="muted small">
        Play a single open string and tune until the note turns green and the
        needle centers. Standard tuning: E A D G B E.
      </p>

      {error && <p className="error">🎤 {error}</p>}

      {!running ? (
        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={start}>🎤 Start tuning</Button>
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
                  {reading.cents > 0 ? `+${reading.cents}` : reading.cents}{" "}
                  cents
                </span>
              </>
            ) : (
              <span className="muted">Listening…</span>
            )}
          </div>

          <div className="tuner-meter">
            <div className="tuner-meter-scale">
              <span>♭</span>
              <span>in tune</span>
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
                ? ` · nearest ${target.label} (${target.freq.toFixed(1)} Hz)`
                : ""}
            </p>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="outline" onClick={stop}>
              ■ Stop
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
