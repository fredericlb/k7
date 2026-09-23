import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { Envelope, EventsResult, Session } from "../types";
import { SessionDetailView } from "../views/SessionDetailView";

interface Props {
  sessionId: string;
  seekTo?: number;
  allTags: string[];
  onBack: () => void;
  onChange: () => void;
  onResume: (session: Session) => void;
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
  const [eventsResult, setEventsResult] = useState<EventsResult | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [minSilence, setMinSilence] = useState(2);
  const [validating, setValidating] = useState<string | null>(null);

  const reloadSession = useCallback(async () => {
    const s = await api.getSession(sessionId);
    setSession(s);
  }, [sessionId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await api.getSession(sessionId);
      if (!alive) return;
      setSession(s);
      if (!s.hasRecording) return;
      const [env, ev] = await Promise.all([
        api.getEnvelope(sessionId),
        api.getEvents(sessionId, undefined, minSilence),
      ]);
      if (!alive) return;
      setEnvelope(env);
      setEventsResult(ev);
      setThreshold(ev.threshold);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (threshold == null || !session?.hasRecording) return;
    const t = setTimeout(async () => {
      const ev = await api.getEvents(sessionId, threshold, minSilence);
      setEventsResult(ev);
    }, 250);
    return () => clearTimeout(t);
  }, [threshold, minSilence, sessionId, session?.hasRecording]);

  const handleAddAnnotation = async (ann: {
    startSec: number;
    endSec: number;
    text: string;
    tags: string[];
  }) => {
    await api.addAnnotation(sessionId, ann);
    await reloadSession();
    onChange();
  };

  const handleUpdateAnnotation = async (
    annId: string,
    patch: {
      text?: string;
      tags?: string[];
      startSec?: number;
      endSec?: number;
    },
  ) => {
    await api.updateAnnotation(sessionId, annId, patch);
    await reloadSession();
    onChange();
  };

  const handleDeleteAnnotation = async (annId: string) => {
    await api.deleteAnnotation(sessionId, annId);
    await reloadSession();
    onChange();
  };

  const handleValidate = async (annId: string) => {
    setValidating(annId);
    try {
      await api.validateMoment(sessionId, annId);
      await reloadSession();
      onChange();
    } finally {
      setValidating(null);
    }
  };

  const handleAddMarker = async (atSec: number) => {
    await api.addMarker(sessionId, { atSec });
    await reloadSession();
    onChange();
  };

  const handleUpdateMarker = async (markerId: string, comment: string) => {
    await api.updateMarker(sessionId, markerId, { comment });
    await reloadSession();
    onChange();
  };

  const handleDeleteMarker = async (markerId: string) => {
    await api.deleteMarker(sessionId, markerId);
    await reloadSession();
    onChange();
  };

  if (!session) return <p className="muted">{m["common.loading"]()}</p>;

  return (
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
      onResume={() => onResume(session)}
      onThresholdChange={setThreshold}
      onMinSilenceChange={setMinSilence}
      onAddAnnotation={handleAddAnnotation}
      onUpdateAnnotation={handleUpdateAnnotation}
      onDeleteAnnotation={handleDeleteAnnotation}
      onValidate={handleValidate}
      onAddMarker={handleAddMarker}
      onUpdateMarker={handleUpdateMarker}
      onDeleteMarker={handleDeleteMarker}
      momentClipUrl={(annId) => api.momentClipUrl(sessionId, annId)}
    />
  );
}
