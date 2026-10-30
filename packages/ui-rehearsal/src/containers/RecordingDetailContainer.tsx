// RecordingDetailContainer.tsx — a capture of the médiathèque as a page with its moments: the same page
// a session has, without the markers and the resume, which are a session's (../../docs/recordings.md).
// The one thing a reader would get wrong: a capture a session saved opens as that session instead.

import { detectEvents } from "@studio/recorder";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
import { m } from "../paraglide/messages.js";
import type { Annotation, Envelope, Session } from "../types";
import { SessionDetailView } from "../views/SessionDetailView";

interface Props {
  recordingPath: string;
  seekTo?: number;
  allTags: string[];
  onBack: () => void;
  onChange: () => void;
  onOpenSession: (sessionId: string, seekTo?: number) => void;
}

/** The capture in the shape the session page draws: no markers, a gain of one. */
function asSession(
  path: string,
  recordedAt: string | null,
  duration: number,
  moments: Annotation[],
): Session {
  return {
    id: path,
    createdAt: recordedAt ?? "",
    duration,
    hasRecording: true,
    recordingPath: path,
    recordingExt: null,
    recordingMime: null,
    gain: 1,
    annotations: moments,
    markers: [],
  };
}

export function RecordingDetailContainer({
  recordingPath,
  seekTo,
  allTags,
  onBack,
  onChange,
  onOpenSession,
}: Props) {
  const [recordedAt, setRecordedAt] = useState<string | null>(null);
  const [moments, setMoments] = useState<Annotation[] | null>(null);
  const [shape, setShape] = useState<{
    envelope: Envelope;
    duration: number;
  } | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [minSilence, setMinSilence] = useState(2);
  const [validating, setValidating] = useState<string | null>(null);
  const { loadError, setLoadError, actionError, guard } = useDetailState();
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(async () => {
    setMoments((await api.recordingMoments(recordingPath)).moments);
  }, [recordingPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded per recording and per retry (`attempt`), not per minSilence move
  useEffect(() => {
    let alive = true;
    (async () => {
      const page = await api.recordingMoments(recordingPath);
      if (!alive) return;
      if (page.sessionId) return onOpenSession(page.sessionId, seekTo);
      setRecordedAt(page.recordedAt);
      setMoments(page.moments);
      setLoadError(null);
      const got = await api.captureEnvelope(recordingPath);
      if (!alive) return;
      setShape(got);
      setThreshold(
        detectEvents(got.envelope, { minSilenceSec: minSilence }).threshold,
      );
    })().catch((e) => {
      if (alive) setLoadError(e);
    });
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

  const changed = async () => {
    await reload();
    onChange();
  };

  const handleValidate = guard(async (id: string) => {
    setValidating(id);
    try {
      await api.validateMoment(id);
      await changed();
    } finally {
      setValidating(null);
    }
  });

  if (moments === null && loadError != null)
    return (
      <LoadFailure error={loadError} onRetry={() => setAttempt((n) => n + 1)} />
    );
  if (moments === null || !shape)
    return <p className="muted">{m["common.loading"]()}</p>;

  const session = asSession(recordingPath, recordedAt, shape.duration, moments);
  const name = recordingPath.slice(recordingPath.lastIndexOf("/") + 1);

  return (
    <>
      <ActionFailure message={actionError} />
      <SessionDetailView
        session={session}
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
        onUpdateMarker={async () => {}}
        onDeleteMarker={async () => {}}
        momentClipUrl={api.momentPageClipUrl}
      />
    </>
  );
}
