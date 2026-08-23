import fixWebmDuration from "fix-webm-duration";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Envelope } from "./types";

const SAMPLE_INTERVAL_MS = 200; // one loudness sample every 200ms
// Auto-gain aims the loudest moment just under full scale, ~ -1 dBFS.
const TARGET_PEAK = 0.9;
const MAX_GAIN = 32;

export interface RecordingResult {
  blob: Blob;
  envelope: Envelope;
  duration: number;
  gain: number; // playback normalization (loudest sample → just below clip)
}

export type RecStatus = "idle" | "recording" | "paused" | "stopped";

/** Record audio while building its loudness envelope live — see ../../../docs/audio.md. */
export function useRecorder() {
  const [status, setStatus] = useState<RecStatus>("idle");
  const [elapsed, setElapsed] = useState(0); // recorded seconds (excludes pauses)
  const [level, setLevel] = useState(0); // current RMS, 0..1
  const [samples, setSamples] = useState<number[]>([]); // live envelope (raw RMS)
  const [gain, setGainState] = useState(1); // auto gain: max before saturation
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const rawPeak = useRef(0); // loudest raw RMS seen so far
  const truePeak = useRef(0); // loudest absolute sample seen so far
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const readRmsRef = useRef<() => number>(() => 0);
  const rafTimer = useRef<number | null>(null);
  const sampleTimer = useRef<number | null>(null);
  const accumulatedMs = useRef(0); // recorded time completed before current segment
  const segmentStart = useRef(0); // performance.now() when current segment began
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const stopTimers = useCallback(() => {
    if (rafTimer.current) cancelAnimationFrame(rafTimer.current);
    if (sampleTimer.current) clearInterval(sampleTimer.current);
    rafTimer.current = null;
    sampleTimer.current = null;
  }, []);

  // Keep the screen awake, so a device locking cannot cut a long take short.
  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock.current = await navigator.wakeLock.request("screen");
    } catch {
      /* not critical — recording still works without it */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  // The OS revokes that lock on backgrounding and never re-grants it, so ask again on return.
  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        mediaRecorder.current?.state === "recording"
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  const cleanup = useCallback(() => {
    stopTimers();
    releaseWakeLock();
    stream.current?.getTracks().forEach((t) => t.stop());
    audioCtx.current?.close().catch(() => {});
    stream.current = null;
    audioCtx.current = null;
  }, [stopTimers, releaseWakeLock]);

  // Gain that brings the loudest moment to just below saturation.
  const autoGain = () =>
    rawPeak.current > 0
      ? Math.min(MAX_GAIN, TARGET_PEAK / rawPeak.current)
      : MAX_GAIN;

  const startTimers = useCallback(() => {
    const tick = () => {
      const rms = readRmsRef.current();
      if (rms > rawPeak.current) rawPeak.current = rms;
      setLevel(rms);
      setGainState(autoGain());
      setElapsed(
        (accumulatedMs.current + (performance.now() - segmentStart.current)) /
          1000,
      );
      rafTimer.current = requestAnimationFrame(tick);
    };
    rafTimer.current = requestAnimationFrame(tick);

    sampleTimer.current = window.setInterval(() => {
      samplesRef.current = [...samplesRef.current, round(readRmsRef.current())];
      setSamples(samplesRef.current);
    }, SAMPLE_INTERVAL_MS);
  }, []);

  const start = useCallback(
    async (existing?: MediaStream) => {
      setError(null);
      try {
        if (!existing && !navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Microphone access needs a secure context (https:// or http://localhost).",
          );
        }
        const media = existing ?? (await acquireMicrophone());
        stream.current = media;

        const ctx = new AudioContext();
        audioCtx.current = ctx;
        // Auto-started outside a user gesture, a context starts suspended and reads silence.
        await ctx.resume().catch(() => {});

        const source = ctx.createMediaStreamSource(media);

        // Analyse the RAW input: gain comes from the observed peak, applied once at stop.
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        readRmsRef.current = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            sum += buf[i] * buf[i];
            const a = Math.abs(buf[i]);
            if (a > peak) peak = a;
          }
          if (peak > truePeak.current) truePeak.current = peak;
          return Math.sqrt(sum / buf.length);
        };

        chunks.current = [];
        samplesRef.current = [];
        rawPeak.current = 0;
        truePeak.current = 0;
        setSamples([]);
        setGainState(MAX_GAIN);

        const mime = pickMimeType();
        // The raw mic track, not the graph, so a suspended context cannot yield an empty take.
        const recorder = new MediaRecorder(
          media,
          mime ? { mimeType: mime } : undefined,
        );
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.current.push(e.data);
        };
        recorder.start(1000); // flush a chunk every second
        mediaRecorder.current = recorder;

        accumulatedMs.current = 0;
        segmentStart.current = performance.now();
        setStatus("recording");
        setElapsed(0);
        startTimers();
        acquireWakeLock();
      } catch (err) {
        setError(describeMicError(err));
        cleanup();
      }
    },
    [cleanup, startTimers, acquireWakeLock],
  );

  const pause = useCallback(() => {
    const r = mediaRecorder.current;
    if (!r || r.state !== "recording") return;
    try {
      r.requestData(); // flush pending audio into a chunk for preview
    } catch {
      /* not all browsers allow requestData mid-record */
    }
    r.pause();
    accumulatedMs.current += performance.now() - segmentStart.current;
    stopTimers();
    releaseWakeLock();
    setLevel(0);
    setElapsed(accumulatedMs.current / 1000);
    setStatus("paused");
  }, [stopTimers, releaseWakeLock]);

  const resume = useCallback(() => {
    const r = mediaRecorder.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    segmentStart.current = performance.now();
    setStatus("recording");
    startTimers();
    acquireWakeLock();
  }, [startTimers, acquireWakeLock]);

  /** Snapshot of everything recorded so far — for listening back while paused. */
  const getPreviewBlob = useCallback(
    () =>
      new Blob(chunks.current, {
        type: mediaRecorder.current?.mimeType || "audio/webm",
      }),
    [],
  );

  /** The gain the finished session will play at, for listening back mid-take. */
  const getPlaybackGain = useCallback(
    () =>
      truePeak.current > 0 ? Math.min(MAX_GAIN, 0.9 / truePeak.current) : 1,
    [],
  );

  const stop = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorder.current;
      if (!recorder) return reject(new Error("not recording"));

      if (recorder.state === "recording") {
        accumulatedMs.current += performance.now() - segmentStart.current;
      }
      stopTimers();

      recorder.onstop = async () => {
        const durationSec = accumulatedMs.current / 1000;
        let blob = new Blob(chunks.current, {
          type: recorder.mimeType || "audio/webm",
        });
        // MediaRecorder leaves the WebM duration out, which makes the file unseekable.
        if (blob.type.includes("webm")) {
          try {
            blob = await fixWebmDuration(blob, durationSec * 1000, {
              logger: false,
            });
          } catch {
            /* fall back to the unfixed blob */
          }
        }
        // Normalize the RMS envelope, so the waveform fills to just below the top.
        const factor = autoGain();
        const samples = samplesRef.current.map((s) =>
          round(Math.min(1, s * factor)),
        );
        // Playback gain: the loudest actual sample brought to just under full scale.
        const playbackGain =
          truePeak.current > 0 ? Math.min(MAX_GAIN, 0.9 / truePeak.current) : 1;
        cleanup();
        setStatus("stopped");
        setLevel(0);
        resolve({
          blob,
          envelope: { intervalMs: SAMPLE_INTERVAL_MS, samples },
          duration: durationSec,
          gain: playbackGain,
        });
      };
      recorder.stop();
    });
  }, [cleanup, stopTimers]);

  return {
    status,
    isRecording: status === "recording",
    isPaused: status === "paused",
    elapsed,
    level,
    samples,
    gain,
    error,
    start,
    pause,
    resume,
    stop,
    getPreviewBlob,
    getPlaybackGain,
  };
}

// Unprocessed constraints first, then a fallback: Safari answers NotFoundError to some.
export async function acquireMicrophone(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true, // auto-level the input so it isn't too quiet
      },
    },
    { audio: true },
  ];
  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Only retry when the constraints themselves might be the problem.
      const name = (err as DOMException)?.name;
      if (name !== "NotFoundError" && name !== "OverconstrainedError")
        throw err;
    }
  }
  throw lastErr;
}

export function describeMicError(err: unknown): string {
  const e = err as DOMException;
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission was denied. Allow it in your browser's site settings and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Check that an input device is connected and not in use by another app.";
    case "NotReadableError":
      return "The microphone is busy or unavailable — another app may be using it.";
    default:
      return e?.message || String(err);
  }
}

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    )
      return c;
  }
  return undefined;
}

const round = (v: number) => Math.round(v * 10000) / 10000;
