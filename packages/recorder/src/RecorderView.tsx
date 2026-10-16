import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  Circle,
  Mic,
  MicOff,
  Pause,
  Sparkles,
  Square,
} from "@frediverse/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectEvents } from "./detect";
import { downloadTake } from "./download";
import { fmtTime, sessionTitle } from "./format";
import { LiveMeter } from "./LiveMeter";
import { LiveWaveform } from "./LiveWaveform";
import { RECORDER_LABELS_EN, type RecorderLabels } from "./labels";
import { useDisplayTimeline, useLiveEnvelope } from "./liveEnvelope";
import {
  HighlightList,
  MetronomeControls,
  RecorderBar,
  ReviewPanel,
} from "./RecorderParts";
import { forgetTake } from "./takeBackup";
import type { DetectedEvent, Envelope, Session } from "./types";
import { useHoldToStop } from "./useHoldToStop";
import { useMetronome } from "./useMetronome";
import { usePreviewGain } from "./usePreviewGain";
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
const NO_SAMPLES: number[] = [];

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
  const [pending, setPending] = useState<PendingAnnotation[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [autoStarting, setAutoStarting] = useState(true);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    rec.start(stream).finally(() => setAutoStarting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The DISPLAY timeline carries the saved take ahead of the new one — see ../../ui-rehearsal/docs/audio.md.
  const live = useLiveEnvelope(
    baseEnvelope?.samples ?? NO_SAMPLES,
    rec.samples,
    rec.gain,
    SAMPLE_INTERVAL_MS,
    rec.readElapsed,
  );
  const displayOffset = live.offsetSec;
  const displayEnvelope = live.envelope;
  const threshold = (live.peak() || 1) * 0.15;

  const { displayEvents, displayMetronome, focus } = useDisplayTimeline(
    displayOffset,
    highlights,
    metronome,
    reviewing,
  );

  // Once a recorded second, over the raw take: the floor is a share of the peak, so the gain changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the second and the status are the clock it runs on.
  useEffect(() => {
    const { events } = detectEvents(
      { intervalMs: SAMPLE_INTERVAL_MS, samples: rec.samples },
      { minSilenceSec: 2 },
    );
    setHighlights((old) => (sameEvents(old, events) ? old : events));
  }, [rec.elapsed, rec.status, rec.samples]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Preview goes through a gain node, so listening back is at the finished session's level.
  const ensurePlaybackGain = usePreviewGain(audioRef, rec.getPlaybackGain);

  // The waveform reads the preview's position each frame itself; this view follows it at timeupdate's pace.
  const readPreview = useMemo(
    () => () => displayOffset + (audioRef.current?.currentTime ?? 0),
    [displayOffset],
  );

  const pickHighlight = (h: DetectedEvent) => {
    rec.pause();
    const url = URL.createObjectURL(rec.getPreviewBlob());
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    setReviewing(h);
    setPreviewTime(h.startSec);
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

  const addPending = (text: string, tags: string[]) => {
    if (!reviewing) return;
    setPending((p) => [
      ...p,
      { startSec: reviewing.startSec, endSec: reviewing.endSec, text, tags },
    ]);
  };

  const resumeRecording = () => {
    audioRef.current?.pause();
    setReviewing(null);
    setPreviewPlaying(false);
    setPreviewTime(0);
    rec.resume();
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

  const { holdProgress, beginHold, cancelHold } = useHoldToStop({
    canStop: () =>
      !uploading && (rec.status === "recording" || rec.status === "paused"),
    onStop: () => void stopAndSave(),
    minimized,
  });

  const tagSuggestions = [
    ...new Set([...allTags, ...pending.flatMap((p) => p.tags)]),
  ].sort();
  const reviewPending = pending.filter(
    (p) => reviewing && p.startSec === reviewing.startSec,
  );

  // The collapsed bar keeps the recorder MOUNTED, which is what keeps the take running.
  if (minimized) {
    return (
      <RecorderBar
        paused={rec.isPaused}
        time={displayOffset + rec.elapsed}
        moments={highlights.length}
        tagged={pending.length}
        onExpand={onExpand}
        labels={L}
      >
        {displayEnvelope.samples.length > 0 ? (
          <LiveWaveform
            envelope={displayEnvelope}
            live={live.feed}
            threshold={threshold}
            events={displayEvents}
            metronome={displayMetronome}
            paused={rec.isPaused}
            height={56}
          />
        ) : (
          <span className="muted small">{sessionTitle(session.createdAt)}</span>
        )}
      </RecorderBar>
    );
  }

  return (
    <Card className="recorder">
      <div className="recorder-head">
        <h2>{sessionTitle(session.createdAt)}</h2>
        <div className="recorder-head-actions">
          <MetronomeControls
            metronome={metronome}
            onStart={(bpm) => startMetronome(bpm, rec.readElapsed())}
            onStop={stopMetronome}
            labels={L}
          />
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
          <LiveMeter level={rec.level} gain={rec.gain} />
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
              live={live.feed}
              threshold={threshold}
              events={displayEvents}
              metronome={displayMetronome}
              paused={rec.isPaused || !!reviewing}
              playhead={reviewing ? readPreview : null}
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
          <HighlightList
            highlights={highlights}
            active={reviewing?.startSec ?? null}
            tagged={pending}
            onPick={pickHighlight}
            labels={L}
          />

          {reviewing && (
            <ReviewPanel
              key={reviewing.startSec}
              moment={reviewing}
              playing={previewPlaying}
              time={previewTime}
              onToggle={togglePreview}
              onAdd={addPending}
              suggestions={tagSuggestions}
              notes={reviewPending}
              labels={L}
            />
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

function sameEvents(a: DetectedEvent[], b: DetectedEvent[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.startSec === b[i].startSec && e.endSec === b[i].endSec)
  );
}
