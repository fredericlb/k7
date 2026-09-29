import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  Check,
  Circle,
  Diamond,
  Flag,
  MoveHorizontal,
  Pause,
  Play,
  Trash2,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { MomentPlayer, TagInput, Waveform } from "@k7/recorder";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { fmtTime, sessionTitle } from "../format";
import { m } from "../paraglide/messages.js";
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
  // The range playRange last started, so its own button can read as Pause while it plays.
  const [playingRange, setPlayingRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
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

  // The one range listener live at a time: a range played after another must not be paused by the first one's.
  const rangeStop = useRef<(() => void) | null>(null);
  const clearRangeStop = () => {
    if (rangeStop.current)
      audioRef.current?.removeEventListener("timeupdate", rangeStop.current);
    rangeStop.current = null;
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      clearRangeStop(); // play-all runs to the end, not to a range someone played earlier
      setPlayingRange(null);
      ensurePlaybackGain();
      playCtx.current?.resume().catch(() => {});
      a.play();
    } else {
      a.pause();
    }
  };

  const playRange = (start: number, end: number) => {
    if (!audioRef.current) return;
    setPlayingRange({ start, end });
    ensurePlaybackGain();
    playCtx.current?.resume().catch(() => {});
    clearRangeStop();
    audioRef.current.currentTime = start;
    audioRef.current.play();
    const stopAt = () => {
      if (audioRef.current && audioRef.current.currentTime >= end) {
        audioRef.current.pause();
        clearRangeStop();
      }
    };
    rangeStop.current = stopAt;
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

  // Saved moments and detected candidates in one sorted list; a span leaves it once saved — built when they change, not on every playhead frame.
  const momentList = useMemo(() => {
    const isSavedSpan = (ev: DetectedEvent) =>
      session.annotations.some(
        (a) =>
          Math.abs(a.startSec - ev.startSec) < 0.25 &&
          Math.abs(a.endSec - ev.endSec) < 0.25,
      );
    return [
      ...session.annotations.map((ann) => ({
        kind: "saved" as const,
        startSec: ann.startSec,
        ann,
      })),
      ...(eventsResult?.events ?? [])
        .filter((ev) => !isSavedSpan(ev))
        .map((ev) => ({
          kind: "detected" as const,
          startSec: ev.startSec,
          ev,
        })),
    ].sort((a, b) => a.startSec - b.startSec);
  }, [session.annotations, eventsResult]);

  // The list re-renders when what it SHOWS changes; the playhead moves sixty times a second and it reads none of it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: its handlers touch refs, setters and these props only.
  const momentsView = useMemo(
    () => (
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
                <Badge variant="tag">{m["session.detected"]()}</Badge>
              </span>
              <div className="row">
                {playing &&
                playingRange?.start === row.ev.startSec &&
                playingRange.end === row.ev.endSec ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => audioRef.current?.pause()}
                  >
                    <Pause className="size-4" /> {m["common.pause"]()}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => playRange(row.ev.startSec, row.ev.endSec)}
                  >
                    <Play className="size-4" /> {m["common.play"]()}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveMoment(row.ev.startSec, row.ev.endSec)}
                >
                  <Diamond className="size-4" /> {m["session.saveAsMoment"]()}
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
    ),
    [
      momentList,
      envelope,
      session.duration,
      allTags,
      validating,
      momentClipUrl,
      editing,
      playing,
      playingRange,
      onUpdateAnnotation,
      onValidate,
      onDeleteAnnotation,
      onAddAnnotation,
    ],
  );

  return (
    <div>
      <div className="detail-head">
        <BackButton to={m["nav.recordings"]()} onClick={onBack} />
        <h2>{sessionTitle(session.createdAt)}</h2>
      </div>

      {!session.hasRecording ? (
        <p className="muted">{m["session.empty"]()}</p>
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
                  {playing ? (
                    <>
                      <Pause className="size-4" /> {m["common.pause"]()}
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> {m["common.play"]()}
                    </>
                  )}
                </Button>
                <span className="muted small tabular">
                  {fmtTime(currentTime)} / {fmtTime(session.duration)}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onAddMarker(currentTime)}
                  title={m["marker.addTitle"]()}
                >
                  <Flag className="size-4" /> {m["marker.add"]()}
                </Button>
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={onResume}
                  title={m["session.continueTitle"]()}
                >
                  <Circle className="size-3 fill-current text-destructive" />{" "}
                  {m["session.continue"]()}
                </Button>
              </div>

              <Card className="controls">
                <div className="control">
                  <label>
                    {m["session.floor"]()}{" "}
                    <b>
                      {(
                        ((threshold ?? 0) / (eventsResult.peak || 1)) *
                        100
                      ).toFixed(0)}
                      %
                    </b>{" "}
                    {m["session.ofPeak"]()}
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
                    {m["session.minGap"]()} <b>{minSilence}s</b>
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
                <p className="muted small">{m["session.noneDetected"]()}</p>
              )}
            </>
          )}

          <Card id="comment-box" className="comment-box">
            <h3>{m["session.addMoment"]()}</h3>
            {selection ? (
              <div className="row">
                <span className="muted small">
                  {m["session.selected"]({
                    from: fmtTime(Math.min(selection.start, selection.end)),
                    to: fmtTime(Math.max(selection.start, selection.end)),
                  })}
                </span>
                <Button onClick={saveSelectionMoment}>
                  <Diamond className="size-4" /> {m["session.saveMoment"]()}
                </Button>
                <Button variant="outline" onClick={() => setSelection(null)}>
                  {m["session.clear"]()}
                </Button>
              </div>
            ) : (
              <p className="muted small">{m["session.selectHelp"]()}</p>
            )}
          </Card>

          {session.markers.length > 0 && (
            <>
              <h3>
                {m["session.markers"]()}{" "}
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
            {m["session.moments"]()}{" "}
            <span className="muted small">({momentList.length})</span>
          </h3>
          {momentList.length === 0 && (
            <p className="muted">{m["session.noMoments"]()}</p>
          )}
          {momentsView}
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
        title={m["moment.playInSession"]()}
      >
        {ann.validated && <Check className="size-3.5" />}
        {fmtTime(shownStart)} – {fmtTime(shownEnd)}
      </Button>
      {!ann.validated && (
        <Button
          variant="outline"
          size="sm"
          disabled={validating === ann.id}
          onClick={() => onValidate(ann.id)}
          title={m["moment.validateTitle"]()}
        >
          {validating === ann.id ? (
            m["moment.extracting"]()
          ) : (
            <>
              <Check className="size-4" /> {m["moment.validate"]()}
            </>
          )}
        </Button>
      )}
      {!isEditing && (
        <Button
          variant="outline"
          size="sm"
          onClick={onBeginEdit}
          title={m["moment.adjustTitle"]()}
        >
          <MoveHorizontal className="size-4" /> {m["moment.adjust"]()}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => onDelete(ann.id)}>
        <Trash2 className="size-4" />
      </Button>

      {isEditing && (
        <div className="moment-range-edit">
          <p className="muted small">{m["moment.nudgeHelp"]()}</p>
          <div className="row range-nudge">
            <span className="muted small">{m["moment.start"]()}</span>
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
              {m["moment.end"]()}
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
              <Check className="size-4" /> {m["moment.apply"]()}
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelEdit}>
              {m["common.cancel"]()}
            </Button>
          </div>
        </div>
      )}

      <div className="row moment-edit">
        <Input
          value={name}
          placeholder={m["moment.name"]()}
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
          removeLabel={(tag) => m["recorder.removeTag"]({ tag })}
        />
      </div>
      {ann.validated && (
        <MomentPlayer
          src={momentClipUrl(ann.id)}
          samples={clipSamples}
          intervalMs={envelope?.intervalMs ?? 200}
          labels={{ play: m["common.play"](), pause: m["common.pause"]() }}
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
        title={m["marker.jump"]()}
      >
        <Flag className="size-4" /> {fmtTime(marker.atSec)}
      </Button>
      <Input
        value={comment}
        placeholder={m["marker.comment"]()}
        onChange={(e) => setComment(e.target.value)}
        onBlur={saveComment}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <Button variant="outline" size="sm" onClick={() => onDelete(marker.id)}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
