// RecorderView.tsx — a take, recorded and drawn in one bar at the foot of the page: its waveforms, with the
// highlights on them, and Pause, Resume and Stop at its right. A highlight clicked pauses the take to listen
// back and tag; Resume carries on. It is never a dialog, so the pages stay usable while it runs (../docs/recorder.md).

import { Button } from "@frediverse/ui/button";
import { Circle, Mic, MicOff, Pause, Square } from "@frediverse/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectEvents } from "./detect";
import { downloadTake } from "./download";
import { sessionTitle } from "./format";
import { LiveWaveform } from "./LiveWaveform";
import { RECORDER_LABELS_EN, type RecorderLabels } from "./labels";
import { useDisplayTimeline, useLiveEnvelope } from "./liveEnvelope";
import {
  MetronomeControls,
  RecorderBar,
  RecorderMore,
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
  onSave: (
    result: {
      blob: Blob;
      envelope: Envelope;
      duration: number;
      gain: number;
      annotations: PendingAnnotation[];
    },
    /** For the host to report the upload's share sent, 0 to 1. */
    onProgress?: (fraction: number) => void,
  ) => Promise<void>;
  onDiscard: () => void;
  /** Every word shown, in the host's language; English when left out. */
  labels?: RecorderLabels;
  /** Put on the ⋮ menu, which opens outside the bar: the host's scope class, so its palette reaches it. */
  menuClassName?: string;
}

const SAMPLE_INTERVAL_MS = 200;
const NO_SAMPLES: number[] = [];

export function RecorderView({
  session,
  stream,
  allTags,
  baseEnvelope = null,
  onSave,
  onDiscard,
  labels: L = RECORDER_LABELS_EN,
  menuClassName,
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
  const [progress, setProgress] = useState<number | null>(null);
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

  const pickEvent = (i: number) => {
    if (highlights[i]) pickHighlight(highlights[i]);
  };

  const togglePreview = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      ensurePlaybackGain();
      const outside =
        reviewing &&
        (a.currentTime < reviewing.startSec ||
          a.currentTime >= reviewing.endSec);
      if (outside) seekPreview(a, reviewing.startSec, () => a.play());
      else a.play();
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

  // Resume carries the take on, whether it was paused or a highlight was being heard.
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
    audioRef.current?.pause();
    setReviewing(null);
    setUploading(true);
    setUploadErr(null);
    setProgress(null);
    try {
      if (!stopped.current) stopped.current = await rec.stop();
      const result = stopped.current;
      await onSave(
        {
          blob: result.blob,
          envelope: result.envelope,
          duration: result.duration,
          gain: result.gain,
          annotations: pending,
        },
        setProgress,
      );
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
  });

  const tagSuggestions = [
    ...new Set([...allTags, ...pending.flatMap((p) => p.tags)]),
  ].sort();
  const reviewPending = pending.filter(
    (p) => reviewing && p.startSec === reviewing.startSec,
  );

  const running = rec.status === "recording" || rec.status === "paused";
  const idle = rec.status === "idle";

  // What the bar says above itself: why it is not recording, or where the saving stands.
  const notice = rec.error ? (
    <p className="error">
      <MicOff className="size-3.5" /> {rec.error}
    </p>
  ) : uploadErr ? (
    <p className="error">{L.uploadFailed(uploadErr)}</p>
  ) : uploading ? (
    <p className="muted" role="status">
      {progress === null
        ? L.uploading
        : progress < 1
          ? L.uploadProgress(Math.round(progress * 100))
          : L.analyzing}
    </p>
  ) : idle && autoStarting ? (
    <p className="muted">
      <Mic className="size-4" /> {L.starting}
    </p>
  ) : null;

  const actions = (
    <>
      {idle && !autoStarting && (
        <Button size="sm" onClick={() => rec.start()}>
          <Circle className="size-2.5 fill-current" /> {L.start}
        </Button>
      )}
      {idle && (
        <Button size="sm" variant="outline" onClick={onDiscard}>
          {L.cancel}
        </Button>
      )}
      {uploadErr && stopped.current && (
        <>
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
        </>
      )}
      {running && rec.isRecording && !reviewing && (
        <Button
          size="icon-sm"
          variant="outline"
          onClick={rec.pause}
          aria-label={L.pause}
          title={L.pause}
        >
          <Pause className="size-4" />
        </Button>
      )}
      {running && (rec.isPaused || reviewing) && (
        <Button
          size="icon-sm"
          onClick={resumeRecording}
          aria-label={L.resume}
          title={L.resume}
        >
          <Circle className="size-2.5 fill-current" />
        </Button>
      )}
      {running && (
        <Button
          size="icon-sm"
          variant="destructive"
          className="hold-btn"
          disabled={uploading}
          aria-label={holdProgress > 0 ? L.holding : L.stopSave}
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
            <Square className="size-4" />
          </span>
        </Button>
      )}
      {running && (
        <RecorderMore className={menuClassName} labels={L}>
          <MetronomeControls
            metronome={metronome}
            onStart={(bpm) => startMetronome(bpm, rec.readElapsed())}
            onStop={stopMetronome}
            labels={L}
          />
        </RecorderMore>
      )}
    </>
  );

  return (
    <RecorderBar
      paused={rec.isPaused || !!reviewing}
      time={displayOffset + rec.elapsed}
      notice={notice}
      review={
        reviewing && (
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
        )
      }
      actions={actions}
      labels={L}
    >
      {/* A hidden preview player, kept mounted so its Web Audio gain node stays wired. */}
      <audio
        ref={audioRef}
        src={previewUrl ?? undefined}
        style={{ display: "none" }}
        onPlay={() => {
          ensurePlaybackGain();
          setPreviewPlaying(true);
        }}
        onPause={() => setPreviewPlaying(false)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setPreviewTime(a.currentTime);
          // The highlight's end stops it and rewinds to its start, so Play hears it again rather than the take's rest.
          if (reviewing && !a.paused && a.currentTime >= reviewing.endSec) {
            a.pause();
            seekPreview(a, reviewing.startSec);
          }
        }}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          // Played only once the seek landed: autoplay would sound the take's first instant.
          if (reviewing) seekPreview(a, reviewing.startSec, () => a.play());
        }}
      />
      {displayEnvelope.samples.length > 0 ? (
        <>
          <div className="rec-bar-whole">
            <LiveWaveform
              whole
              envelope={displayEnvelope}
              live={live.feed}
              threshold={threshold}
              events={displayEvents}
              metronome={displayMetronome}
              paused={rec.isPaused || !!reviewing}
              playhead={reviewing ? readPreview : null}
              focus={focus}
              onPickEvent={running ? pickEvent : undefined}
              height={56}
            />
          </div>
          <div className="rec-bar-live">
            <LiveWaveform
              envelope={displayEnvelope}
              live={live.feed}
              threshold={threshold}
              events={displayEvents}
              metronome={displayMetronome}
              paused={rec.isPaused || !!reviewing}
              playhead={reviewing ? readPreview : null}
              focus={focus}
              onPickEvent={running ? pickEvent : undefined}
              height={56}
            />
          </div>
        </>
      ) : (
        <span className="muted small">{sessionTitle(session.createdAt)}</span>
      )}
    </RecorderBar>
  );
}

/** Seeks to `target`, then calls `landed`; a duration-less file is first sent past its end so it learns its length. */
function seekPreview(
  audio: HTMLAudioElement,
  target: number,
  landed?: () => void,
) {
  const go = () => {
    if (landed) audio.addEventListener("seeked", landed, { once: true });
    try {
      audio.currentTime = Number.isFinite(audio.duration)
        ? Math.min(target, Math.max(0, audio.duration - 0.1))
        : target;
    } catch {
      landed?.();
    }
  };
  if (Number.isFinite(audio.duration) && audio.duration > 0) return go();
  const onUpdate = () => {
    audio.removeEventListener("timeupdate", onUpdate);
    go();
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
