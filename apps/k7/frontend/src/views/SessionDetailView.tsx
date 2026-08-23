import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Input } from "@frediverse/ui/input";
import { MomentPlayer, TagInput, Waveform } from "@k7/recorder";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtTime, sessionTitle } from "../format";
import type {
  Annotation,
  DetectedEvent,
  Envelope,
  EventsResult,
  Marker,
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
  onBack: () => void;
  onResume: () => void;
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
  onAddMarker: (atSec: number) => Promise<void>;
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
  onBack,
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
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  // The moment whose range is being adjusted, as a live draft committed on Apply.
  const [editing, setEditing] = useState<{
    id: string;
    start: number;
    end: number;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const seekApplied = useRef(false);
  const playCtx = useRef<AudioContext | null>(null);
  const gainNode = useRef<GainNode | null>(null);

  useEffect(() => {
    const loop = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };
    if (playing) rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  useEffect(() => {
    if (seekTo == null) return;
    seekApplied.current = false;
    const a = audioRef.current;
    if (a && a.readyState >= 1) {
      a.currentTime = seekTo;
      seekApplied.current = true;
    }
    setCurrentTime(seekTo);
  }, [seekTo, session.id]);

  const ensurePlaybackGain = useCallback(() => {
    const a = audioRef.current;
    if (!a || playCtx.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(a);
      const g = ctx.createGain();
      g.gain.value = session.gain || 1;
      src.connect(g);
      g.connect(ctx.destination);
      playCtx.current = ctx;
      gainNode.current = g;
    } catch {
      /* play at unity gain */
    }
  }, [session.gain]);

  useEffect(() => {
    if (gainNode.current) gainNode.current.gain.value = session.gain || 1;
  }, [session.gain]);

  useEffect(() => {
    return () => {
      playCtx.current?.close().catch(() => {});
      playCtx.current = null;
      gainNode.current = null;
    };
  }, [session.id]);

  const seek = (sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = sec;
    setCurrentTime(sec);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      ensurePlaybackGain();
      playCtx.current?.resume().catch(() => {});
      a.play();
    } else {
      a.pause();
    }
  };

  const playRange = (start: number, end: number) => {
    if (!audioRef.current) return;
    ensurePlaybackGain();
    playCtx.current?.resume().catch(() => {});
    audioRef.current.currentTime = start;
    audioRef.current.play();
    const stopAt = () => {
      if (audioRef.current && audioRef.current.currentTime >= end) {
        audioRef.current.pause();
        audioRef.current.removeEventListener("timeupdate", stopAt);
      }
    };
    audioRef.current.addEventListener("timeupdate", stopAt);
  };

  // Saved at once, named by their start and untagged; renaming happens inline afterwards.
  const saveMoment = async (startSec: number, endSec: number) => {
    await onAddAnnotation({
      startSec,
      endSec,
      text: fmtTime(startSec),
      tags: [],
    });
  };

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

  // Saved moments and detected candidates in one sorted list; a span leaves it once saved.
  const detectedEvents = eventsResult?.events ?? [];
  const isSavedSpan = (ev: DetectedEvent) =>
    session.annotations.some(
      (a) =>
        Math.abs(a.startSec - ev.startSec) < 0.25 &&
        Math.abs(a.endSec - ev.endSec) < 0.25,
    );
  const momentList = [
    ...session.annotations.map((ann) => ({
      kind: "saved" as const,
      startSec: ann.startSec,
      ann,
    })),
    ...detectedEvents
      .filter((ev) => !isSavedSpan(ev))
      .map((ev) => ({ kind: "detected" as const, startSec: ev.startSec, ev })),
  ].sort((a, b) => a.startSec - b.startSec);

  return (
    <div>
      <Button variant="link" className="text-xs" onClick={onBack}>
        ← All sessions
      </Button>
      <h2 style={{ marginTop: 8 }}>{sessionTitle(session.createdAt)}</h2>

      {!session.hasRecording ? (
        <p className="muted">This session has no recording yet.</p>
      ) : (
        <>
          <audio
            ref={audioRef}
            src={audioSrc}
            crossOrigin="use-credentials"
            style={{ display: "none" }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              if (seekTo != null && !seekApplied.current) {
                e.currentTarget.currentTime = seekTo;
                setCurrentTime(seekTo);
                seekApplied.current = true;
              }
            }}
          />

          {envelope && eventsResult && (
            <>
              <Waveform
                envelope={envelope}
                duration={session.duration}
                threshold={threshold ?? eventsResult.threshold}
                events={eventsResult.events}
                annotations={session.annotations}
                markers={session.markers}
                currentTime={currentTime}
                selection={selection}
                onSeek={seek}
                onSelect={setSelection}
                onMarkerClick={(m) => seek(m.atSec)}
                editing={
                  editing ? { start: editing.start, end: editing.end } : null
                }
                onEditRange={setEditRange}
              />

              <div className="row playback-controls">
                <Button onClick={togglePlay}>
                  {playing ? "⏸ Pause" : "▶ Play"}
                </Button>
                <span className="muted small tabular">
                  {fmtTime(currentTime)} / {fmtTime(session.duration)}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onAddMarker(currentTime)}
                  title="Drop a marker at the current position"
                >
                  🚩 Add marker
                </Button>
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={onResume}
                  title="Record more audio onto the end of this session"
                >
                  ● Continue recording
                </Button>
              </div>

              <Card className="controls">
                <div className="control">
                  <label>
                    Silence floor (min volume):{" "}
                    <b>
                      {(
                        ((threshold ?? 0) / (eventsResult.peak || 1)) *
                        100
                      ).toFixed(0)}
                      %
                    </b>{" "}
                    of peak
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={eventsResult.peak || 1}
                    step={(eventsResult.peak || 1) / 200}
                    value={threshold ?? 0}
                    onChange={(e) => onThresholdChange(Number(e.target.value))}
                  />
                </div>
                <div className="control">
                  <label>
                    Min silence gap: <b>{minSilence}s</b>
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={minSilence}
                    onChange={(e) => onMinSilenceChange(Number(e.target.value))}
                  />
                </div>
              </Card>

              {eventsResult.events.length === 0 && (
                <p className="muted small">
                  No moments detected at this floor. Lower it to pick up quieter
                  playing.
                </p>
              )}
            </>
          )}

          <Card id="comment-box" className="comment-box">
            <h3>Add a moment</h3>
            {selection ? (
              <div className="row">
                <span className="muted small">
                  Selected {fmtTime(Math.min(selection.start, selection.end))} –{" "}
                  {fmtTime(Math.max(selection.start, selection.end))}
                </span>
                <Button onClick={saveSelectionMoment}>◆ Save moment</Button>
                <Button variant="outline" onClick={() => setSelection(null)}>
                  Clear
                </Button>
              </div>
            ) : (
              <p className="muted small">
                Drag across the waveform to select a timespan (or save a
                detected highlight). You can name and tag it after saving.
              </p>
            )}
          </Card>

          {session.markers.length > 0 && (
            <>
              <h3>
                Markers{" "}
                <span className="muted small">({session.markers.length})</span>
              </h3>
              <ul className="marker-list">
                {session.markers.map((m) => (
                  <MarkerRow
                    key={m.id}
                    marker={m}
                    onSeek={seek}
                    onUpdate={onUpdateMarker}
                    onDelete={onDeleteMarker}
                  />
                ))}
              </ul>
            </>
          )}

          <h3>
            Moments <span className="muted small">({momentList.length})</span>
          </h3>
          {momentList.length === 0 && <p className="muted">No moments yet.</p>}
          <ul className="annotation-list">
            {momentList.map((row) =>
              row.kind === "saved" ? (
                <MomentRow
                  key={`saved-${row.ann.id}`}
                  ann={row.ann}
                  envelope={envelope}
                  duration={session.duration}
                  allTags={allTags}
                  validating={validating}
                  momentClipUrl={momentClipUrl}
                  editRange={
                    editing?.id === row.ann.id
                      ? { start: editing.start, end: editing.end }
                      : null
                  }
                  onPlay={playRange}
                  onUpdate={onUpdateAnnotation}
                  onValidate={onValidate}
                  onDelete={onDeleteAnnotation}
                  onBeginEdit={() => beginEdit(row.ann)}
                  onEditRange={setEditRange}
                  onApplyEdit={applyEdit}
                  onCancelEdit={cancelEdit}
                />
              ) : (
                <li
                  key={`detected-${row.ev.startSec}-${row.ev.endSec}`}
                  className="event-item"
                >
                  <span>
                    {fmtTime(row.ev.startSec)} – {fmtTime(row.ev.endSec)}{" "}
                    <span className="muted small">
                      ({fmtTime(row.ev.durationSec)})
                    </span>{" "}
                    <Badge variant="tag">detected</Badge>
                  </span>
                  <div className="row">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => playRange(row.ev.startSec, row.ev.endSec)}
                    >
                      ▶ Play
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveMoment(row.ev.startSec, row.ev.endSec)}
                    >
                      ◆ Save as moment
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}

interface MomentRowProps {
  ann: Annotation;
  envelope: Envelope | null;
  duration: number;
  allTags: string[];
  validating: string | null;
  momentClipUrl: (annId: string) => string;
  // Non-null while this moment's time range is being adjusted (live draft).
  editRange: Selection | null;
  onPlay: (start: number, end: number) => void;
  onUpdate: (
    annId: string,
    patch: {
      text?: string;
      tags?: string[];
      startSec?: number;
      endSec?: number;
    },
  ) => Promise<void>;
  onValidate: (annId: string) => Promise<void>;
  onDelete: (annId: string) => Promise<void>;
  onBeginEdit: () => void;
  onEditRange: (range: Selection) => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
}

function MomentRow({
  ann,
  envelope,
  duration,
  allTags,
  validating,
  momentClipUrl,
  editRange,
  onPlay,
  onUpdate,
  onValidate,
  onDelete,
  onBeginEdit,
  onEditRange,
  onApplyEdit,
  onCancelEdit,
}: MomentRowProps) {
  // Local draft for the name so typing stays snappy; persisted on blur/Enter.
  const [name, setName] = useState(ann.text);
  useEffect(() => setName(ann.text), [ann.text]);

  const saveName = () => {
    const t = name.trim();
    if (t !== ann.text) onUpdate(ann.id, { text: t });
  };

  // The session envelope sliced to this span, so the clip player needs no envelope of its own.
  const clipSamples = useMemo(() => {
    if (!envelope) return [];
    const per = envelope.intervalMs / 1000;
    const i0 = Math.max(0, Math.floor(ann.startSec / per));
    const i1 = Math.min(envelope.samples.length, Math.ceil(ann.endSec / per));
    return envelope.samples.slice(i0, i1);
  }, [envelope, ann.startSec, ann.endSec]);

  const isEditing = editRange != null;
  // While editing, show the live draft range; otherwise the committed one.
  const shownStart = editRange ? editRange.start : ann.startSec;
  const shownEnd = editRange ? editRange.end : ann.endSec;

  const nudgeStart = (d: number) => {
    if (!editRange) return;
    const start = Math.max(
      0,
      Math.min(editRange.start + d, editRange.end - 0.1),
    );
    onEditRange({ start, end: editRange.end });
  };
  const nudgeEnd = (d: number) => {
    if (!editRange) return;
    const end = Math.min(
      duration,
      Math.max(editRange.end + d, editRange.start + 0.1),
    );
    onEditRange({ start: editRange.start, end });
  };

  return (
    <li
      className={`annotation-item${ann.validated ? " validated" : ""}${
        isEditing ? " editing" : ""
      }`}
    >
      <Button
        variant="link"
        onClick={() => onPlay(shownStart, shownEnd)}
        title="Play in the session"
      >
        {ann.validated ? "✓ " : ""}
        {fmtTime(shownStart)} – {fmtTime(shownEnd)}
      </Button>
      {!ann.validated && (
        <Button
          variant="outline"
          size="sm"
          disabled={validating === ann.id}
          onClick={() => onValidate(ann.id)}
          title="Extract a standalone clip of this timespan"
        >
          {validating === ann.id ? "Extracting…" : "✓ Validate"}
        </Button>
      )}
      {!isEditing && (
        <Button
          variant="outline"
          size="sm"
          onClick={onBeginEdit}
          title="Adjust this moment's time range"
        >
          ↔ Adjust range
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => onDelete(ann.id)}>
        🗑
      </Button>

      {isEditing && (
        <div className="moment-range-edit">
          <p className="muted small">
            Drag the handles on the waveform above, or nudge:
          </p>
          <div className="row range-nudge">
            <span className="muted small">Start</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nudgeStart(-0.5)}
            >
              −0.5s
            </Button>
            <Button variant="outline" size="sm" onClick={() => nudgeStart(0.5)}>
              +0.5s
            </Button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              End
            </span>
            <Button variant="outline" size="sm" onClick={() => nudgeEnd(-0.5)}>
              −0.5s
            </Button>
            <Button variant="outline" size="sm" onClick={() => nudgeEnd(0.5)}>
              +0.5s
            </Button>
          </div>
          <div className="row">
            <Button size="sm" onClick={onApplyEdit}>
              ✓ Apply &amp; re-extract
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="row moment-edit">
        <Input
          value={name}
          placeholder="Name…"
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <TagInput
          value={ann.tags}
          onChange={(tags) => onUpdate(ann.id, { tags })}
          suggestions={allTags}
        />
      </div>
      {ann.validated && (
        <MomentPlayer
          src={momentClipUrl(ann.id)}
          samples={clipSamples}
          intervalMs={envelope?.intervalMs ?? 200}
        />
      )}
    </li>
  );
}

interface MarkerRowProps {
  marker: Marker;
  onSeek: (sec: number) => void;
  onUpdate: (markerId: string, comment: string) => Promise<void>;
  onDelete: (markerId: string) => Promise<void>;
}

function MarkerRow({ marker, onSeek, onUpdate, onDelete }: MarkerRowProps) {
  // Local draft so typing stays snappy; persisted on blur/Enter.
  const [comment, setComment] = useState(marker.comment);
  useEffect(() => setComment(marker.comment), [marker.comment]);

  const saveComment = () => {
    const c = comment.trim();
    if (c !== marker.comment) onUpdate(marker.id, c);
  };

  return (
    <li className="marker-item">
      <Button
        variant="link"
        onClick={() => onSeek(marker.atSec)}
        title="Jump to this marker"
      >
        🚩 {fmtTime(marker.atSec)}
      </Button>
      <Input
        value={comment}
        placeholder="Comment…"
        onChange={(e) => setComment(e.target.value)}
        onBlur={saveComment}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <Button variant="outline" size="sm" onClick={() => onDelete(marker.id)}>
        🗑
      </Button>
    </li>
  );
}
