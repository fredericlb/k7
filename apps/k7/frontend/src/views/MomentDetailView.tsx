import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  ArrowLeft,
  Check,
  CornerUpLeft,
  Flag,
  Pause,
  Play,
  Trash2,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Waveform } from "@k7/recorder";
import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtTime, sessionTitle } from "../format";
import type { Marker, Moment } from "../types";

interface Props {
  moment: Moment;
  clipUrl: string;
  onBack: () => void;
  onDelete: () => Promise<void>;
  // Present only while the originating session still exists.
  onOpenSession: (() => void) | null;
  onAddMarker: (atSec: number) => Promise<void>;
  onUpdateMarker: (markerId: string, comment: string) => Promise<void>;
  onDeleteMarker: (markerId: string) => Promise<void>;
}

export function MomentDetailView({
  moment,
  clipUrl,
  onBack,
  onDelete,
  onOpenSession,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
}: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The moment's span, refined by the clip's real duration, which loudnorm can nudge.
  const [clipDuration, setClipDuration] = useState(
    Math.max(0.1, moment.endSec - moment.startSec),
  );
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);

  const markers = moment.markers ?? [];

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

  const seek = (sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = sec;
    setCurrentTime(sec);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  };

  const remove = async () => {
    if (!confirm("Delete this moment and its clip?")) return;
    await onDelete();
  };

  const title = moment.text.trim() || fmtTime(moment.startSec);

  return (
    <div className="moment-detail">
      <Button variant="link" className="text-xs" onClick={onBack}>
        <ArrowLeft className="size-3.5" /> All moments
      </Button>

      <h2 style={{ marginTop: 8 }}>
        {moment.validated && <Check className="size-5" />}
        {title}
      </h2>
      <p className="muted">
        {fmtTime(moment.startSec)} – {fmtTime(moment.endSec)} ·{" "}
        {fmtTime(clipDuration)} long
      </p>

      {moment.tags.length > 0 && (
        <div className="row" style={{ gap: 4, margin: "6px 0 4px" }}>
          {moment.tags.map((t) => (
            <Badge key={t} variant="tag">
              #{t}
            </Badge>
          ))}
        </div>
      )}

      {moment.validated ? (
        <>
          <audio
            ref={audioRef}
            src={clipUrl}
            crossOrigin="use-credentials"
            style={{ display: "none" }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setClipDuration(d);
            }}
          />

          {moment.envelope ? (
            <Waveform
              envelope={moment.envelope}
              duration={clipDuration}
              threshold={0}
              events={[]}
              annotations={[]}
              markers={markers}
              currentTime={currentTime}
              selection={null}
              onSeek={seek}
              onSelect={() => {}}
              onMarkerClick={(m) => seek(m.atSec)}
            />
          ) : (
            <p className="muted small">No waveform available for this clip.</p>
          )}

          <div className="row playback-controls">
            <Button onClick={togglePlay}>
              {playing ? (
                <>
                  <Pause className="size-4" /> Pause
                </>
              ) : (
                <>
                  <Play className="size-4" /> Play
                </>
              )}
            </Button>
            <span className="muted small tabular">
              {fmtTime(currentTime)} / {fmtTime(clipDuration)}
            </span>
            <Button
              variant="outline"
              onClick={() => onAddMarker(currentTime)}
              title="Drop a marker at the current position"
            >
              <Flag className="size-4" /> Add marker
            </Button>
          </div>
        </>
      ) : (
        <p className="muted">No clip has been extracted for this moment yet.</p>
      )}

      {markers.length > 0 && (
        <>
          <h3>
            Markers <span className="muted small">({markers.length})</span>
          </h3>
          <ul className="marker-list">
            {markers.map((m) => (
              <MomentMarkerRow
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

      <div className="row" style={{ marginTop: 12 }}>
        {onOpenSession ? (
          <Button variant="outline" onClick={onOpenSession}>
            <CornerUpLeft className="size-4" /> Open in session at{" "}
            {fmtTime(moment.startSec)}
            {moment.sessionCreatedAt
              ? ` · ${sessionTitle(moment.sessionCreatedAt)}`
              : ""}
          </Button>
        ) : (
          <span className="muted small">
            The original session is no longer available.
          </span>
        )}
        <Button variant="outline" size="sm" onClick={remove}>
          <Trash2 className="size-4" /> Delete moment
        </Button>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Captured {fmtDate(moment.createdAt)}
      </p>
    </div>
  );
}

interface MarkerRowProps {
  marker: Marker;
  onSeek: (sec: number) => void;
  onUpdate: (markerId: string, comment: string) => Promise<void>;
  onDelete: (markerId: string) => Promise<void>;
}

function MomentMarkerRow({
  marker,
  onSeek,
  onUpdate,
  onDelete,
}: MarkerRowProps) {
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
        <Flag className="size-4" /> {fmtTime(marker.atSec)}
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
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
