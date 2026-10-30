// SessionDetailView.tsx — a recording's page: the take's waveform and transport, its markers, and its
// moments saved and detected. A session's, or any capture's, which has no markers and no resume.
// The playback is useSessionPlayback; each part is a component of its own.

import { Button } from "@frediverse/ui/button";
import { Trash2 } from "@frediverse/ui/icons";
import { useCallback, useState } from "react";
import { BackButton } from "../components/BackButton";
import { MarkerRow } from "../components/MarkerRow";
import { SessionMoments } from "../components/SessionMoments";
import { SessionWaveformPanel } from "../components/SessionWaveformPanel";
import { fmtTime, sessionTitle } from "../format";
import { useSessionPlayback } from "../hooks/useSessionPlayback";
import { m } from "../paraglide/messages.js";
import type {
  Annotation,
  Envelope,
  EventsResult,
  Selection,
  Session,
} from "../types";

interface Props {
  session: Session;
  envelope: Envelope | null;
  eventsResult: EventsResult | null;
  threshold: number | null;
  minSilence: number;
  allTags: string[];
  seekTo?: number;
  audioSrc: string;
  validating: string | null;
  /** What the page is titled; a session's date when absent. */
  title?: string;
  /** Where Back leads, as its label says; the sessions when absent. */
  backTo?: string;
  onBack: () => void;
  /** Delete the recording with its session; absent, the page offers no delete. */
  onDelete?: () => Promise<void>;
  onResume?: () => void;
  onThresholdChange: (t: number) => void;
  onMinSilenceChange: (ms: number) => void;
  onAddAnnotation: (ann: {
    startSec: number;
    endSec: number;
    text: string;
    tags: string[];
  }) => Promise<void>;
  onUpdateAnnotation: (
    annId: string,
    patch: {
      text?: string;
      tags?: string[];
      startSec?: number;
      endSec?: number;
    },
  ) => Promise<void>;
  onDeleteAnnotation: (annId: string) => Promise<void>;
  onValidate: (annId: string) => Promise<void>;
  onAddMarker?: (atSec: number) => Promise<void>;
  onUpdateMarker: (markerId: string, comment: string) => Promise<void>;
  onDeleteMarker: (markerId: string) => Promise<void>;
  momentClipUrl: (annId: string) => string;
}

export function SessionDetailView({
  session,
  envelope,
  eventsResult,
  threshold,
  minSilence,
  allTags,
  seekTo,
  audioSrc,
  validating,
  title,
  backTo,
  onBack,
  onDelete,
  onResume,
  onThresholdChange,
  onMinSilenceChange,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onValidate,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
  momentClipUrl,
}: Props) {
  const playback = useSessionPlayback(session, seekTo);
  const [selection, setSelection] = useState<Selection | null>(null);
  // The moment whose range is being adjusted, as a live draft committed on Apply.
  const [editing, setEditing] = useState<{
    id: string;
    start: number;
    end: number;
  } | null>(null);

  // Saved at once, named by their start and untagged; renaming happens inline afterwards.
  const saveMoment = useCallback(
    async (startSec: number, endSec: number) => {
      await onAddAnnotation({
        startSec,
        endSec,
        text: fmtTime(startSec),
        tags: [],
      });
    },
    [onAddAnnotation],
  );

  const saveSelectionMoment = async () => {
    if (!selection) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    setSelection(null);
    await saveMoment(start, end);
  };

  // --- Range editing (drag handles + nudge) ---------------------------------
  const beginEdit = (ann: Annotation) => {
    setSelection(null);
    setEditing({ id: ann.id, start: ann.startSec, end: ann.endSec });
  };
  const setEditRange = (range: Selection) =>
    setEditing((e) => (e ? { ...e, start: range.start, end: range.end } : e));
  const cancelEdit = () => setEditing(null);
  const applyEdit = async () => {
    if (!editing) return;
    const start = Math.min(editing.start, editing.end);
    const end = Math.max(editing.start, editing.end);
    setEditing(null);
    await onUpdateAnnotation(editing.id, { startSec: start, endSec: end });
  };

  return (
    <div>
      <div className="detail-head">
        <BackButton to={backTo ?? m["recording.back"]()} onClick={onBack} />
        <h2>{title ?? sessionTitle(session.createdAt)}</h2>
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            title={m["session.delete"]()}
            onClick={() => void onDelete().catch(() => {})}
          >
            <Trash2 className="size-4" /> {m["session.delete"]()}
          </Button>
        )}
      </div>

      {!session.hasRecording ? (
        <p className="muted">{m["session.empty"]()}</p>
      ) : (
        <>
          <audio
            {...playback.audioProps}
            src={audioSrc}
            crossOrigin="use-credentials"
            style={{ display: "none" }}
          />

          <SessionWaveformPanel
            session={session}
            envelope={envelope}
            eventsResult={eventsResult}
            threshold={threshold}
            minSilence={minSilence}
            clock={playback.clock}
            playing={playback.playing}
            selection={selection}
            editing={
              editing ? { start: editing.start, end: editing.end } : null
            }
            onSeek={playback.seek}
            onSelect={setSelection}
            onEditRange={setEditRange}
            onTogglePlay={playback.togglePlay}
            onAddMarker={onAddMarker}
            onResume={onResume}
            onThresholdChange={onThresholdChange}
            onMinSilenceChange={onMinSilenceChange}
            onSaveSelection={saveSelectionMoment}
          />

          {session.markers.length > 0 && (
            <>
              <h3>
                {m["session.markers"]()}{" "}
                <span className="muted small">({session.markers.length})</span>
              </h3>
              <ul className="marker-list">
                {session.markers.map((mk) => (
                  <MarkerRow
                    key={mk.id}
                    marker={mk}
                    onSeek={playback.seek}
                    onUpdate={onUpdateMarker}
                    onDelete={onDeleteMarker}
                  />
                ))}
              </ul>
            </>
          )}

          <SessionMoments
            session={session}
            events={eventsResult?.events ?? NO_EVENTS}
            envelope={envelope}
            allTags={allTags}
            validating={validating}
            momentClipUrl={momentClipUrl}
            editing={editing}
            playing={playback.playing}
            playingRange={playback.playingRange}
            onPlay={playback.playRange}
            onPause={playback.pause}
            onSave={saveMoment}
            onUpdate={onUpdateAnnotation}
            onValidate={onValidate}
            onDelete={onDeleteAnnotation}
            onBeginEdit={beginEdit}
            onEditRange={setEditRange}
            onApplyEdit={applyEdit}
            onCancelEdit={cancelEdit}
          />
        </>
      )}
    </div>
  );
}

// One empty list, so the moments' memo does not see a new one on every render.
const NO_EVENTS: EventsResult["events"] = [];
