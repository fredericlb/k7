import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Input } from "@frediverse/ui/input";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectEvents } from "./detect";
import { fmtTime, sessionTitle } from "./format";
import { LiveWaveform } from "./LiveWaveform";
import { TagInput } from "./TagInput";
import type { DetectedEvent, Envelope, Session } from "./types";
import { useMetronome } from "./useMetronome";
import { useRecorder } from "./useRecorder";

export interface PendingAnnotation {
  startSec: number;
  endSec: number;
  text: string;
  tags: string[];
}

interface Props {
  session: Session;
  stream?: MediaStream;
  allTags: string[];
  // When resuming a saved session, its stored envelope so the waveform shows the
  // existing recording ahead of the new take.
  baseEnvelope?: Envelope | null;
  // When true, the recorder keeps running but collapses to a fixed bottom bar so
  // the user can browse the rest of the app. `onExpand` reopens the full view.
  minimized?: boolean;
  onExpand?: () => void;
  onSave: (result: {
    blob: Blob;
    envelope: Envelope;
    duration: number;
    gain: number;
    annotations: PendingAnnotation[];
  }) => Promise<void>;
  onDiscard: () => void;
}

const SAMPLE_INTERVAL_MS = 200;
const HOLD_MS = 2000; // hold-to-stop duration for the button / space bar

export function RecorderView({
  session,
  stream,
  allTags,
  baseEnvelope = null,
  minimized = false,
  onExpand,
  onSave,
  onDiscard,
}: Props) {
  const rec = useRecorder();
  const {
    metronome,
    start: startMetronome,
    stop: stopMetronome,
  } = useMetronome();
  const [highlights, setHighlights] = useState<DetectedEvent[]>([]);
  const [reviewing, setReviewing] = useState<DetectedEvent | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAnnotation[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [autoStarting, setAutoStarting] = useState(true);
  const [holdProgress, setHoldProgress] = useState(0); // 0→1 while holding to stop
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoStarted = useRef(false);
  const holdStart = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);
  const previewRaf = useRef<number | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const gainNode = useRef<GainNode | null>(null);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    rec.start(stream).finally(() => setAutoStarting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoized so the object identity is stable while paused for review —
  // otherwise a new envelope every render would re-run the waveform's canvas
  // draw on each playhead tick (the stutter this avoids).
  const { envelope, threshold } = useMemo(() => {
    const gainedSamples = rec.samples.map((s) => Math.min(1, s * rec.gain));
    let peak = 0;
    for (const v of gainedSamples) if (v > peak) peak = v;
    if (peak === 0) peak = 1;
    return {
      envelope: { intervalMs: SAMPLE_INTERVAL_MS, samples: gainedSamples },
      threshold: peak * 0.15,
    };
  }, [rec.samples, rec.gain]);

  // When resuming, the waveform shows the saved recording ahead of the new
  // take. The display timeline is offset by the existing envelope's length so
  // the two stretches line up seam-to-seam (the recorder's own timeline —
  // highlights, preview, saved annotations — stays relative to the new take).
  const baseSamples = useMemo(
    () => baseEnvelope?.samples ?? [],
    [baseEnvelope],
  );
  const displayOffset = baseSamples.length * (SAMPLE_INTERVAL_MS / 1000);

  const displayEnvelope = useMemo(
    () =>
      baseSamples.length
        ? {
            intervalMs: SAMPLE_INTERVAL_MS,
            samples: [...baseSamples, ...envelope.samples],
          }
        : envelope,
    [baseSamples, envelope],
  );

  const displayEvents = useMemo(
    () =>
      displayOffset
        ? highlights.map((h) => ({
            ...h,
            startSec: h.startSec + displayOffset,
            endSec: h.endSec + displayOffset,
          }))
        : highlights,
    [highlights, displayOffset],
  );

  const displayMetronome = useMemo(
    () =>
      metronome && displayOffset
        ? { ...metronome, startSec: metronome.startSec + displayOffset }
        : metronome,
    [metronome, displayOffset],
  );

  // Stable identity while reviewing so the waveform's canvas draw isn't
  // re-triggered on every playhead tick (offset onto the display timeline).
  const focus = useMemo(
    () =>
      reviewing
        ? {
            start: reviewing.startSec + displayOffset,
            end: reviewing.endSec + displayOffset,
          }
        : null,
    [reviewing, displayOffset],
  );

  useEffect(() => {
    const { events } = detectEvents(envelope, { minSilenceSec: 2 });
    setHighlights(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.samples]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Route preview playback through a gain node so listening back while
  // recording is normalized to the same level the finished session will be.
  const ensurePlaybackGain = () => {
    const a = audioRef.current;
    if (!a) return;
    if (!playCtx.current) {
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(a);
        const g = ctx.createGain();
        src.connect(g);
        g.connect(ctx.destination);
        playCtx.current = ctx;
        gainNode.current = g;
      } catch {
        return; // fall back to unity-gain playback
      }
    }
    if (gainNode.current) gainNode.current.gain.value = rec.getPlaybackGain();
    playCtx.current?.resume().catch(() => {});
  };

  useEffect(() => {
    return () => {
      playCtx.current?.close().catch(() => {});
      playCtx.current = null;
      gainNode.current = null;
    };
  }, []);

  // Smoothly follow the preview audio's position (for the waveform playhead)
  // while it's playing, mirroring the stopped-session playback loop.
  useEffect(() => {
    const loop = () => {
      if (audioRef.current) setPreviewTime(audioRef.current.currentTime);
      previewRaf.current = requestAnimationFrame(loop);
    };
    if (previewPlaying) previewRaf.current = requestAnimationFrame(loop);
    return () => {
      if (previewRaf.current) cancelAnimationFrame(previewRaf.current);
    };
  }, [previewPlaying]);

  const pickHighlight = (h: DetectedEvent) => {
    rec.pause();
    const url = URL.createObjectURL(rec.getPreviewBlob());
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    setReviewing(h);
    setPreviewTime(h.startSec);
    setComment("");
    setTags([]);
  };

  const togglePreview = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      ensurePlaybackGain();
      a.play();
    } else {
      a.pause();
    }
  };

  const addPending = () => {
    if (!reviewing || (!comment.trim() && tags.length === 0)) return;
    setPending((p) => [
      ...p,
      {
        startSec: reviewing.startSec,
        endSec: reviewing.endSec,
        text: comment.trim(),
        tags,
      },
    ]);
    setComment("");
    setTags([]);
  };

  const resumeRecording = () => {
    audioRef.current?.pause();
    setReviewing(null);
    setPreviewPlaying(false);
    setPreviewTime(0);
    rec.resume();
  };

  const toggleMetronome = () => {
    if (metronome) {
      stopMetronome();
      return;
    }
    const input = prompt("Metronome tempo (BPM)?", "120");
    if (input == null) return;
    const bpm = Number(input);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    startMetronome(bpm, rec.elapsed);
  };

  const stopAndSave = async () => {
    setUploading(true);
    setUploadErr(null);
    try {
      const result = await rec.stop();
      await onSave({
        blob: result.blob,
        envelope: result.envelope,
        duration: result.duration,
        gain: result.gain,
        annotations: pending,
      });
    } catch (e) {
      setUploadErr((e as Error).message);
      setUploading(false);
    }
  };

  // Stopping requires a deliberate 2-second hold (button press or space bar) so
  // a stray tap/keypress can't end a long take. Progress drives a fill on the
  // button; releasing early cancels.
  const canStop = () =>
    !uploading && (rec.status === "recording" || rec.status === "paused");

  const cancelHold = () => {
    if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    holdRaf.current = null;
    holdStart.current = null;
    setHoldProgress(0);
  };

  const beginHold = () => {
    if (holdStart.current != null || !canStop()) return;
    holdStart.current = performance.now();
    const tick = () => {
      if (holdStart.current == null) return;
      const p = Math.min(1, (performance.now() - holdStart.current) / HOLD_MS);
      setHoldProgress(p);
      if (p >= 1) {
        cancelHold();
        stopAndSave();
      } else {
        holdRaf.current = requestAnimationFrame(tick);
      }
    };
    holdRaf.current = requestAnimationFrame(tick);
  };

  // The once-mounted key listener reads the latest hold/cancel via refs so it
  // never rebinds and never captures stale status/pending.
  const beginHoldRef = useRef(beginHold);
  beginHoldRef.current = beginHold;
  const cancelHoldRef = useRef(cancelHold);
  cancelHoldRef.current = cancelHold;
  const canStopRef = useRef(canStop);
  canStopRef.current = canStop;
  // While minimized (browsing another page), don't let a stray space bar press
  // start the hold-to-stop — the stop control isn't visible there.
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;

  useEffect(() => {
    const isEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // Don't hijack space while typing a comment/tag, when nothing to stop, or
      // while minimized (the stop control isn't on screen then).
      if (isEditable(e.target) || minimizedRef.current || !canStopRef.current())
        return;
      // Swallow every space keydown while active (incl. auto-repeats) so the
      // page doesn't scroll, but only start the hold on the first one.
      e.preventDefault();
      if (!e.repeat) beginHoldRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") cancelHoldRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Stop any in-flight hold animation if the recorder unmounts mid-hold.
  useEffect(() => {
    return () => {
      if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    };
  }, []);

  const meterPct = Math.min(100, rec.level * rec.gain * 100);
  const tagSuggestions = [
    ...new Set([...allTags, ...pending.flatMap((p) => p.tags)]),
  ].sort();
  const reviewPending = pending.filter(
    (p) => reviewing && p.startSec === reviewing.startSec,
  );

  // Collapsed bar shown while the user browses elsewhere — keeps the recorder
  // mounted (so recording continues) and surfaces the live waveform + a running
  // count of detected moments. Clicking it reopens the full recorder.
  if (minimized) {
    return (
      <div
        className="rec-bar"
        role="button"
        tabIndex={0}
        title="Return to recording"
        onClick={onExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter") onExpand?.();
        }}
      >
        <div className="rec-bar-status">
          {rec.isPaused ? (
            <Badge variant="amber">paused</Badge>
          ) : (
            <Badge variant="rec">● rec</Badge>
          )}
          <span className="tabular">
            {fmtTime(displayOffset + rec.elapsed)}
          </span>
        </div>

        <div className="rec-bar-wave">
          {displayEnvelope.samples.length > 0 ? (
            <LiveWaveform
              envelope={displayEnvelope}
              elapsed={displayOffset + rec.elapsed}
              threshold={threshold}
              events={displayEvents}
              metronome={displayMetronome}
              paused={rec.isPaused}
              height={56}
            />
          ) : (
            <span className="muted small">
              {sessionTitle(session.createdAt)}
            </span>
          )}
        </div>

        <div className="rec-bar-meta">
          <span title="Detected moments so far">
            ◆ {highlights.length} moment{highlights.length === 1 ? "" : "s"}
          </span>
          {pending.length > 0 && (
            <span className="muted small">{pending.length} tagged</span>
          )}
          <span className="ghost small rec-bar-open">Open ▸</span>
        </div>
      </div>
    );
  }

  return (
    <Card className="recorder">
      <h2>{sessionTitle(session.createdAt)}</h2>
      {rec.error && <p className="error">🎤 {rec.error}</p>}
      {uploadErr && <p className="error">Upload failed: {uploadErr}</p>}

      {/* Persistent (hidden) preview player — kept mounted across reviews so its
          Web Audio gain node stays wired for normalized playback. */}
      <audio
        ref={audioRef}
        src={previewUrl ?? undefined}
        autoPlay
        style={{ display: "none" }}
        onPlay={() => {
          ensurePlaybackGain();
          setPreviewPlaying(true);
        }}
        onPause={() => setPreviewPlaying(false)}
        onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (reviewing) seekPreview(e.currentTarget, reviewing.startSec);
        }}
      />

      {rec.status === "idle" &&
        (autoStarting && !rec.error ? (
          <p className="muted">
            🎤 Starting recording… allow microphone access if prompted.
          </p>
        ) : (
          <>
            <p className="muted">
              Everything except silences (2s+ below the floor) is flagged live
              as a highlight — click one to pause, listen back, and tag it, then
              resume.
            </p>
            <div className="row">
              <Button onClick={() => rec.start()}>● Start recording</Button>
              <Button variant="outline" onClick={onDiscard}>
                Cancel
              </Button>
            </div>
          </>
        ))}

      {rec.status !== "idle" && rec.status !== "stopped" && (
        <>
          <div className="meter">
            <div
              className="meter-fill"
              style={{
                width: `${meterPct}%`,
                background: meterPct > 92 ? "var(--red)" : "var(--accent)",
              }}
            />
          </div>
          <div className="muted small" style={{ textAlign: "center" }}>
            auto gain {rec.gain.toFixed(1)}× — leveled to just below saturation
          </div>

          <div className="timer">
            {fmtTime(rec.elapsed)}{" "}
            {rec.isPaused ? (
              <Badge variant="amber">paused</Badge>
            ) : (
              <Badge variant="rec">● rec</Badge>
            )}
          </div>

          <div
            className="row playback-controls"
            style={{ justifyContent: "center" }}
          >
            <Button
              variant={metronome ? "default" : "outline"}
              onClick={toggleMetronome}
            >
              {metronome ? `⏹ Metronome ${metronome.bpm} BPM` : "🥁 Metronome"}
            </Button>
          </div>

          {displayEnvelope.samples.length > 0 && (
            <LiveWaveform
              envelope={displayEnvelope}
              elapsed={displayOffset + rec.elapsed}
              threshold={threshold}
              events={displayEvents}
              metronome={displayMetronome}
              paused={rec.isPaused || !!reviewing}
              playhead={reviewing ? displayOffset + previewTime : null}
              focus={focus}
            />
          )}

          <h3>
            🟢 Highlights{" "}
            <span className="muted small">({highlights.length})</span>
          </h3>
          {highlights.length === 0 && (
            <p className="muted small">
              Keep playing — everything between 2s+ silences shows up here.
            </p>
          )}
          <ul className="event-list">
            {highlights.map((h, i) => {
              const active = reviewing?.startSec === h.startSec;
              return (
                <li
                  key={i}
                  className={`event-item link-row${active ? " active-row" : ""}`}
                  onClick={() => pickHighlight(h)}
                >
                  <span>
                    {fmtTime(h.startSec)} – {fmtTime(h.endSec)}{" "}
                    <span className="muted small">
                      ({fmtTime(h.durationSec)})
                    </span>
                    {pending.some((p) => p.startSec === h.startSec) && (
                      <Badge variant="tag" className="ml-2">
                        tagged
                      </Badge>
                    )}
                  </span>
                  <span className="muted small">⏸ listen &amp; tag</span>
                </li>
              );
            })}
          </ul>

          {reviewing && (
            <Card className="review-panel">
              <h3>
                Reviewing {fmtTime(reviewing.startSec)} –{" "}
                {fmtTime(reviewing.endSec)}
              </h3>
              <div className="row playback-controls">
                <Button onClick={togglePreview}>
                  {previewPlaying ? "⏸ Pause" : "▶ Play"}
                </Button>
                <span className="muted small tabular">
                  {fmtTime(previewTime)}
                </span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <Input
                  value={comment}
                  placeholder="What happened here?"
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPending()}
                />
                <TagInput
                  value={tags}
                  onChange={setTags}
                  suggestions={tagSuggestions}
                />
                <Button
                  disabled={!comment.trim() && tags.length === 0}
                  onClick={addPending}
                >
                  Add
                </Button>
              </div>
              {reviewPending.length > 0 && (
                <ul className="annotation-list" style={{ marginTop: 8 }}>
                  {reviewPending.map((p, i) => (
                    <li key={i} className="annotation-item">
                      {p.tags.map((t) => (
                        <Badge key={t} variant="tag">
                          #{t}
                        </Badge>
                      ))}
                      <span className="annotation-text">{p.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            {rec.isRecording && !reviewing && (
              <Button variant="outline" onClick={rec.pause}>
                ⏸ Pause
              </Button>
            )}
            {reviewing && (
              <Button onClick={resumeRecording}>● Resume recording</Button>
            )}
            <Button
              variant="destructive"
              className="hold-btn"
              disabled={uploading}
              title="Hold 2s to stop & save (or hold Space)"
              onPointerDown={(e) => {
                e.preventDefault();
                beginHold();
              }}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
            >
              <span
                className="hold-fill"
                style={{ width: `${holdProgress * 100}%` }}
              />
              <span className="hold-label">
                {holdProgress > 0 ? "Hold to stop…" : "■ Stop & save"}
              </span>
            </Button>
            <span className="muted small">or hold space</span>
            {pending.length > 0 && (
              <span className="muted small">
                {pending.length} tag{pending.length > 1 ? "s" : ""} pending
              </span>
            )}
          </div>
        </>
      )}

      {uploading && <p className="muted">Uploading &amp; analyzing…</p>}
    </Card>
  );
}

function seekPreview(audio: HTMLAudioElement, target: number) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = Math.min(target, audio.duration - 0.1);
    return;
  }
  const onUpdate = () => {
    audio.removeEventListener("timeupdate", onUpdate);
    try {
      audio.currentTime = target;
    } catch {
      /* ignore */
    }
  };
  audio.addEventListener("timeupdate", onUpdate);
  try {
    audio.currentTime = 1e6;
  } catch {
    /* ignore */
  }
}
