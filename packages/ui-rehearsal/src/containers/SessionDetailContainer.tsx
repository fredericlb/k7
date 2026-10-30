import { detectEvents } from "@studio/recorder";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
import { m } from "../paraglide/messages.js";
import type { Envelope, Session } from "../types";
import { SessionDetailView } from "../views/SessionDetailView";

interface Props {
  sessionId: string;
  seekTo?: number;
  allTags: string[];
  onBack: () => void;
  onChange: () => void;
  onResume: (session: Session) => Promise<void>;
}

export function SessionDetailContainer({
  sessionId,
  seekTo,
  allTags,
  onBack,
  onChange,
  onResume,
}: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [minSilence, setMinSilence] = useState(2);
  const [validating, setValidating] = useState<string | null>(null);
  const { loadError, setLoadError, actionError, guard } = useDetailState();
  const [attempt, setAttempt] = useState(0);

  const reloadSession = useCallback(async () => {
    const s = await api.getSession(sessionId);
    setSession(s);
  }, [sessionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded per session and per retry (`attempt`), not per minSilence move
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await api.getSession(sessionId);
      if (!alive) return;
      setSession(s);
      setLoadError(null);
      if (!s.hasRecording) return;
      const env = await api.getEnvelope(sessionId);
      if (!alive) return;
      setEnvelope(env);
      setThreshold(detectEvents(env, { minSilenceSec: minSilence }).threshold);
    })().catch((e) => {
      if (alive) setLoadError(e);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, attempt]);

  // Detection runs here, over the stored envelope: the server keeps no detector — ../docs/recordings.md.
  const eventsResult = useMemo(
    () =>
      envelope && threshold != null
        ? detectEvents(envelope, { threshold, minSilenceSec: minSilence })
        : null,
    [envelope, threshold, minSilence],
  );

  const handleAddAnnotation = guard(
    async (ann: {
      startSec: number;
      endSec: number;
      text: string;
      tags: string[];
    }) => {
      // A session without a recording has nothing to cut a moment from.
      if (!session?.recordingPath) return;
      await api.addMoment(session.recordingPath, ann);
      await reloadSession();
      onChange();
    },
  );

  const handleUpdateAnnotation = guard(
    async (
      annId: string,
      patch: {
        text?: string;
        tags?: string[];
        startSec?: number;
        endSec?: number;
      },
    ) => {
      await api.updateMoment(annId, patch);
      await reloadSession();
      onChange();
    },
  );

  const handleDeleteAnnotation = guard(async (annId: string) => {
    await api.deleteMoment(annId);
    await reloadSession();
    onChange();
  });

  const handleValidate = guard(async (annId: string) => {
    setValidating(annId);
    try {
      await api.validateMoment(annId);
      await reloadSession();
      onChange();
    } finally {
      setValidating(null);
    }
  });

  const handleAddMarker = guard(async (atSec: number) => {
    await api.addMarker(sessionId, { atSec });
    await reloadSession();
    onChange();
  });

  const handleUpdateMarker = guard(
    async (markerId: string, comment: string) => {
      await api.updateMarker(sessionId, markerId, { comment });
      await reloadSession();
      onChange();
    },
  );

  const handleDeleteMarker = guard(async (markerId: string) => {
    await api.deleteMarker(sessionId, markerId);
    await reloadSession();
    onChange();
  });

  if (!session && loadError != null)
    return (
      <LoadFailure error={loadError} onRetry={() => setAttempt((n) => n + 1)} />
    );
  if (!session) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <ActionFailure message={actionError} />
      <SessionDetailView
        session={session}
        envelope={envelope}
        eventsResult={eventsResult}
        threshold={threshold}
        minSilence={minSilence}
        allTags={allTags}
        seekTo={seekTo}
        // Version by duration so the browser refetches after an append changes it.
        audioSrc={`${api.recordingUrl(sessionId)}?v=${session.duration}`}
        validating={validating}
        onBack={onBack}
        // The refusal is already on the page through guard; nothing else wants the rejection.
        onResume={() => void guard(onResume)(session).catch(() => {})}
        onThresholdChange={setThreshold}
        onMinSilenceChange={setMinSilence}
        onAddAnnotation={handleAddAnnotation}
        onUpdateAnnotation={handleUpdateAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
        onValidate={handleValidate}
        onAddMarker={handleAddMarker}
        onUpdateMarker={handleUpdateMarker}
        onDeleteMarker={handleDeleteMarker}
        momentClipUrl={api.momentPageClipUrl}
      />
    </>
  );
}
