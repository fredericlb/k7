// RecordingDetailContainer.tsx — a recording's one page, by its path: the session page when a session of
// yours saved it, else the same page over the capture, its gain and waveform measured by the médiathèque.
// The one thing a reader would get wrong: a capture has no Continue and no delete here (../../docs/recordings.md).

import { Button } from "@frediverse/ui/button";
import { detectEvents } from "@studio/recorder";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { BackButton } from "../components/BackButton";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
import { m } from "../paraglide/messages.js";
import type { Envelope, RecordingMoments, Session } from "../types";
import { SessionDetailView } from "../views/SessionDetailView";
import { SessionDetailContainer } from "./SessionDetailContainer";

interface Props {
  recordingPath: string;
  seekTo?: number;
  allTags: string[];
  onBack: () => void;
  onDeleted: () => void;
  onChange: () => void;
  onResume: (session: Session) => Promise<void>;
}

export function RecordingDetailContainer(props: Props) {
  const { recordingPath } = props;
  const [page, setPage] = useState<RecordingMoments | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded per recording and per retry (`attempt`)
  useEffect(() => {
    let alive = true;
    api
      .recordingMoments(recordingPath)
      .then((got) => {
        if (!alive) return;
        setPage(got);
        setLoadError(null);
      })
      .catch((e) => alive && setLoadError(e));
    return () => {
      alive = false;
    };
  }, [recordingPath, attempt]);

  if (!page && loadError != null)
    return (
      <LoadFailure error={loadError} onRetry={() => setAttempt((n) => n + 1)} />
    );
  if (!page) return <p className="muted">{m["common.loading"]()}</p>;
  // A take of yours: its session's page, with its markers, its Continue and its delete.
  if (page.sessionId)
    return (
      <SessionDetailContainer
        key={page.sessionId}
        sessionId={page.sessionId}
        seekTo={props.seekTo}
        allTags={props.allTags}
        onBack={props.onBack}
        onDeleted={props.onDeleted}
        onChange={props.onChange}
        onResume={props.onResume}
      />
    );
  return <CaptureDetail {...props} first={page} />;
}

/** The capture in the shape the session page draws. */
function asSession(
  page: RecordingMoments,
  duration: number,
  gain: number,
): Session {
  return {
    id: page.path,
    createdAt: page.recordedAt ?? "",
    duration,
    hasRecording: true,
    recordingPath: page.path,
    recordingExt: null,
    recordingMime: null,
    gain,
    annotations: page.moments,
    markers: page.markers,
  };
}

function CaptureDetail({
  recordingPath,
  seekTo,
  allTags,
  onBack,
  onChange,
  first,
}: Props & { first: RecordingMoments }) {
  const [page, setPage] = useState(first);
  const [shape, setShape] = useState<{
    envelope: Envelope;
    duration: number;
    gain: number;
  } | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [minSilence, setMinSilence] = useState(2);
  const [validating, setValidating] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { actionError, guard } = useDetailState();

  // biome-ignore lint/correctness/useExhaustiveDependencies: measured per recording and per retry (`attempt`), not per minSilence move
  useEffect(() => {
    let alive = true;
    setShapeError(null);
    api
      .captureEnvelope(recordingPath)
      .then((got) => {
        if (!alive) return;
        setShape(got);
        setThreshold(
          detectEvents(got.envelope, { minSilenceSec: minSilence }).threshold,
        );
      })
      // No waveform is no page: the audio and the moments stay reachable.
      .catch((e: Error) => alive && setShapeError(e.message));
    return () => {
      alive = false;
    };
  }, [recordingPath, attempt]);

  // Detection runs here, over the measured envelope, as on a session's page — ../../docs/recordings.md.
  const eventsResult = useMemo(
    () =>
      shape && threshold != null
        ? detectEvents(shape.envelope, {
            threshold,
            minSilenceSec: minSilence,
          })
        : null,
    [shape, threshold, minSilence],
  );

  const changed = useCallback(async () => {
    setPage(await api.recordingMoments(recordingPath));
    onChange();
  }, [recordingPath, onChange]);

  const handleValidate = guard(async (id: string) => {
    setValidating(id);
    try {
      await api.validateMoment(id);
      await changed();
    } finally {
      setValidating(null);
    }
  });

  const name = recordingPath.slice(recordingPath.lastIndexOf("/") + 1);

  if (shapeError)
    return (
      <div>
        <div className="detail-head">
          <BackButton to={m["recording.back"]()} onClick={onBack} />
          <h2>{name}</h2>
        </div>
        <p className="muted">
          {m["recording.noWaveform"]({ reason: shapeError })}{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {m["recording.retry"]()}
          </Button>
        </p>
        {/* biome-ignore lint/a11y/useMediaCaption: a rehearsal take has no captions to offer */}
        <audio
          controls
          preload="metadata"
          src={api.captureUrl(recordingPath)}
          crossOrigin="use-credentials"
          style={{ width: "100%" }}
        />
      </div>
    );
  if (!shape) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <ActionFailure message={actionError} />
      <SessionDetailView
        session={asSession(page, shape.duration, shape.gain)}
        title={name}
        backTo={m["recording.back"]()}
        envelope={shape.envelope}
        eventsResult={eventsResult}
        threshold={threshold}
        minSilence={minSilence}
        allTags={allTags}
        seekTo={seekTo}
        audioSrc={api.captureUrl(recordingPath)}
        validating={validating}
        onBack={onBack}
        onThresholdChange={setThreshold}
        onMinSilenceChange={setMinSilence}
        onAddAnnotation={guard(async (ann) => {
          await api.addMoment(recordingPath, ann);
          await changed();
        })}
        onUpdateAnnotation={guard(async (id, patch) => {
          await api.updateMoment(id, patch);
          await changed();
        })}
        onDeleteAnnotation={guard(async (id) => {
          await api.deleteMoment(id);
          await changed();
        })}
        onValidate={handleValidate}
        onAddMarker={guard(async (atSec) => {
          await api.addRecordingMarker(recordingPath, { atSec });
          await changed();
        })}
        onUpdateMarker={guard(async (id, comment) => {
          await api.updateRecordingMarker(id, { comment });
          await changed();
        })}
        onDeleteMarker={guard(async (id) => {
          await api.deleteRecordingMarker(id);
          await changed();
        })}
        momentClipUrl={api.momentPageClipUrl}
      />
    </>
  );
}
