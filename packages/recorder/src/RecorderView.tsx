import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  ChevronRight,
  Circle,
  Diamond,
  Metronome,
  Mic,
  MicOff,
  Pause,
  Play,
  Sparkles,
  Square,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectEvents } from "./detect";
import { downloadTake } from "./download";
import { fmtTime, sessionTitle } from "./format";
import { LiveWaveform } from "./LiveWaveform";
import { RECORDER_LABELS_EN, type RecorderLabels } from "./labels";
import { TagInput } from "./TagInput";
import { forgetTake } from "./takeBackup";
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
  // A resumed session's stored envelope, drawn ahead of the new take.
  baseEnvelope?: Envelope | null;
  // Collapsed to a bottom bar and still recording; `onExpand` reopens the full view.
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
  /** Controls the host adds at the end of the header row (the pop-in's Hide). */
  headerActions?: React.ReactNode;
  /** Every word shown, in the host's language; English when left out. */
  labels?: RecorderLabels;
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
  headerActions,
  labels: L = RECORDER_LABELS_EN,
}: Props) {
  const rec = useRecorder(L.mic);
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

  // Memoized: a fresh envelope object would redraw the canvas on every playhead tick.
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

  // The DISPLAY timeline carries the saved take ahead of the new one — see ../../ui-rehearsal/docs/audio.md.
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

  // Stable identity again, and offset onto the display timeline.
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

  // Preview goes through a gain node, so listening back is at the finished session's level.
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

  // Follow the preview's position for the playhead, as the stopped-session loop does.
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

  // The tempo field's text; a running metronome follows it as soon as it reads as a tempo.
  const [bpmText, setBpmText] = useState("120");
  const parseBpm = (t: string) => {
    const n = Number(t);
    return Number.isFinite(n) && n >= 20 && n <= 400 ? n : null;
  };

  const toggleMetronome = () => {
    if (metronome) {
      stopMetronome();
      return;
    }
    const bpm = parseBpm(bpmText);
    if (bpm != null) startMetronome(bpm, rec.elapsed);
  };

  const changeBpm = (t: string) => {
    setBpmText(t);
    const bpm = parseBpm(t);
    if (metronome && bpm != null && bpm !== metronome.bpm)
      startMetronome(bpm, rec.elapsed);
  };

  // A take that exists nowhere but this tab asks before the tab goes: recording, paused, uploading or refused (../../ui-rehearsal/docs/recordings.md).
  const atRisk =
    rec.status === "recording" ||
    rec.status === "paused" ||
    uploading ||
    uploadErr !== null;
  useEffect(() => {
    if (!atRisk) return;
    const hold = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [atRisk]);

  // The stopped take, kept until it is saved: a failed upload must leave something to retry or download, not an error and nothing else.
  const stopped = useRef<Awaited<ReturnType<typeof rec.stop>> | null>(null);

  const stopAndSave = async () => {
    setUploading(true);
    setUploadErr(null);
    try {
      if (!stopped.current) stopped.current = await rec.stop();
      const result = stopped.current;
      await onSave({
        blob: result.blob,
        envelope: result.envelope,
        duration: result.duration,
        gain: result.gain,
        annotations: pending,
      });
      // Saved: the crash backup has done its job (takeBackup.ts).
      void forgetTake(result.takeId);
    } catch (e) {
      setUploadErr((e as Error).message);
      setUploading(false);
    }
  };

  // Stopping takes a deliberate HOLD_MS hold, so no stray tap ends a long take.
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

  // Refs, so the once-mounted key listener never rebinds nor captures a stale status.
  const beginHoldRef = useRef(beginHold);
  beginHoldRef.current = beginHold;
  const cancelHoldRef = useRef(cancelHold);
  cancelHoldRef.current = cancelHold;
  const canStopRef = useRef(canStop);
  canStopRef.current = canStop;
  // Minimized, the stop control is off screen, so a space bar press must not start the hold.
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
      // Never hijack space while typing a comment or a tag.
      if (isEditable(e.target) || minimizedRef.current || !canStopRef.current())
        return;
      // Swallow every space keydown so the page cannot scroll, but hold only on the first.
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

  // The collapsed bar keeps the recorder MOUNTED, which is what keeps the take running.
  if (minimized) {
    return (
      <div
        className="rec-bar"
        role="button"
        tabIndex={0}
        title={L.returnToRecording}
        onClick={onExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter") onExpand?.();
        }}
      >
        <div className="rec-bar-status">
          {rec.isPaused ? (
            <Badge variant="amber">{L.paused}</Badge>
          ) : (
            <Badge variant="rec">
              <Circle className="size-2.5 fill-current" /> {L.rec}
            </Badge>
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
          <span title={L.detectedSoFar}>
            <Diamond className="size-3" /> {L.moments(highlights.length)}
          </span>
          {pending.length > 0 && (
            <span className="muted small">{L.tagged(pending.length)}</span>
          )}
          <span className="ghost small rec-bar-open">
            {L.open} <ChevronRight className="size-3.5" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card className="recorder">
      <div className="recorder-head">
        <h2>{sessionTitle(session.createdAt)}</h2>
        <div className="recorder-head-actions">
          <Input
            type="number"
            min={20}
            max={400}
            className="recorder-bpm"
            value={bpmText}
            onChange={(e) => changeBpm(e.target.value)}
            aria-label={L.tempo}
            title={L.tempo}
          />
          <Button
            variant={metronome ? "default" : "ghost"}
            size="icon-sm"
            className="recorder-metro"
            onClick={toggleMetronome}
            disabled={!metronome && parseBpm(bpmText) == null}
            aria-pressed={metronome != null}
            aria-label={metronome ? L.metronomeStop : L.metronomeStart}
            title={metronome ? L.metronomeOn(metronome.bpm) : L.metronomeStart}
          >
            <Metronome className="size-4" />
          </Button>
          {headerActions}
        </div>
      </div>
      {rec.error && (
        <p className="error">
          <MicOff className="size-3.5" /> {rec.error}
        </p>
      )}
      {uploadErr && <p className="error">{L.uploadFailed(uploadErr)}</p>}
      {uploadErr && stopped.current && (
        <div className="flex gap-2">
          <Button size="sm" onClick={stopAndSave} disabled={uploading}>
            {L.retryUpload}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadTake(stopped.current!.blob)}
          >
            {L.downloadTake}
          </Button>
        </div>
      )}

      {/* A hidden preview player, kept mounted so its Web Audio gain node stays wired. */}
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
            <Mic className="size-4" /> {L.starting}
          </p>
        ) : (
          <>
            <p className="muted">{L.intro}</p>
            <div className="row">
              <Button onClick={() => rec.start()}>
                <Circle className="size-2.5 fill-current" /> {L.start}
              </Button>
              <Button variant="outline" onClick={onDiscard}>
                {L.cancel}
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
            {L.autoGain(rec.gain.toFixed(1))}
          </div>

          <div className="timer">
            {fmtTime(rec.elapsed)}{" "}
            {rec.isPaused ? (
              <Badge variant="amber">{L.paused}</Badge>
            ) : (
              <Badge variant="rec">
                <Circle className="size-2.5 fill-current" /> {L.rec}
              </Badge>
            )}
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
            <Sparkles className="size-4" /> {L.highlights}{" "}
            <span className="muted small">({highlights.length})</span>
          </h3>
          {highlights.length === 0 && (
            <p className="muted small">{L.keepPlaying}</p>
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
                        {L.taggedBadge}
                      </Badge>
                    )}
                  </span>
                  <span className="muted small">
                    <Pause className="size-3" /> {L.listenAndTag}
                  </span>
                </li>
              );
            })}
          </ul>

          {reviewing && (
            <Card className="review-panel">
              <h3>
                {L.reviewing(
                  fmtTime(reviewing.startSec),
                  fmtTime(reviewing.endSec),
                )}
              </h3>
              <div className="row playback-controls">
                <Button onClick={togglePreview}>
                  {previewPlaying ? (
                    <>
                      <Pause className="size-4" /> {L.pause}
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> {L.play}
                    </>
                  )}
                </Button>
                <span className="muted small tabular">
                  {fmtTime(previewTime)}
                </span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <Input
                  value={comment}
                  placeholder={L.whatHappened}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPending()}
                />
                <TagInput
                  value={tags}
                  onChange={setTags}
                  suggestions={tagSuggestions}
                  removeLabel={L.removeTag}
                />
                <Button
                  disabled={!comment.trim() && tags.length === 0}
                  onClick={addPending}
                >
                  {L.add}
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
                <Pause className="size-4" /> {L.pause}
              </Button>
            )}
            {reviewing && (
              <Button onClick={resumeRecording}>
                <Circle className="size-2.5 fill-current" /> {L.resume}
              </Button>
            )}
            <Button
              variant="destructive"
              className="hold-btn"
              disabled={uploading}
              title={L.holdTitle}
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
                {holdProgress > 0 ? (
                  L.holding
                ) : (
                  <>
                    <Square className="size-4" /> {L.stopSave}
                  </>
                )}
              </span>
            </Button>
            <span className="muted small">{L.orHoldSpace}</span>
            {pending.length > 0 && (
              <span className="muted small">
                {L.tagsPending(pending.length)}
              </span>
            )}
          </div>
        </>
      )}

      {uploading && <p className="muted">{L.uploading}</p>}
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
