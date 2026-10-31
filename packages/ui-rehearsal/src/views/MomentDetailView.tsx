import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Check,
  CornerUpLeft,
  Flag,
  Pause,
  Play,
  Trash2,
} from "@frediverse/ui/icons";
import { Waveform } from "@studio/recorder";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { MarkerRow } from "../components/MarkerRow";
import {
  type MomentState,
  MomentStateIcon,
  ShareMomentButton,
} from "../components/MomentServerShare";
import { confirmLoss } from "../confirm";
import { fmtDate, fmtTime, sessionTitle } from "../format";
import { m } from "../paraglide/messages.js";
import type { Moment } from "../types";

interface Props {
  moment: Moment;
  clipUrl: string;
  onBack: () => void;
  onDelete: () => Promise<void>;
  // Present only while the originating session still exists.
  onOpenRecording: (() => void) | null;
  onAddMarker: (atSec: number) => Promise<void>;
  onUpdateMarker: (markerId: string, comment: string) => Promise<void>;
  onDeleteMarker: (markerId: string) => Promise<void>;
  /** The moment's copy on a paired server; absent, nothing is drawn. */
  share?: {
    state: MomentState | null;
    host: string;
    onShare: () => Promise<void>;
  };
}

export function MomentDetailView({
  moment,
  clipUrl,
  onBack,
  onDelete,
  onOpenRecording,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
  share,
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
  // Shared from a machine: read here, edited there — ../../../rehearsal-server/docs/momentShare.md.
  const readOnly = moment.sharedFrom !== "";

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
    if (!(await confirmLoss(m["moment.confirmDelete"]()))) return;
    await onDelete();
  };

  const title = moment.text.trim() || fmtTime(moment.startSec);

  return (
    <div className="moment-detail">
      <div className="detail-head">
        <BackButton to={m["recording.back"]()} onClick={onBack} />
        <h2>
          {moment.validated && <Check className="size-5" />}
          {title}
        </h2>
      </div>
      <p className="muted">
        {fmtTime(moment.startSec)} – {fmtTime(moment.endSec)} ·{" "}
        {m["moment.long"]({ duration: fmtTime(clipDuration) })}
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
              onMarkerClick={(mk) => seek(mk.atSec)}
            />
          ) : (
            <p className="muted small">{m["moment.noWaveform"]()}</p>
          )}

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
              {fmtTime(currentTime)} / {fmtTime(clipDuration)}
            </span>
            {!readOnly && (
              <Button
                variant="outline"
                onClick={() => onAddMarker(currentTime)}
                title={m["marker.addTitle"]()}
              >
                <Flag className="size-4" /> {m["marker.add"]()}
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="muted">{m["moment.noClip"]()}</p>
      )}

      {markers.length > 0 && (
        <>
          <h3>
            {m["session.markers"]()}{" "}
            <span className="muted small">({markers.length})</span>
          </h3>
          <ul className="marker-list">
            {markers.map((mk) => (
              <MarkerRow
                key={mk.id}
                marker={mk}
                onSeek={seek}
                onUpdate={readOnly ? undefined : onUpdateMarker}
                onDelete={readOnly ? undefined : onDeleteMarker}
              />
            ))}
          </ul>
        </>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        {onOpenRecording ? (
          <Button variant="outline" onClick={onOpenRecording}>
            <CornerUpLeft className="size-4" />{" "}
            {m["moment.openInRecording"]({ at: fmtTime(moment.startSec) })}
            {moment.recordedAt ? ` · ${sessionTitle(moment.recordedAt)}` : ""}
          </Button>
        ) : (
          <span className="muted small">{m["moment.recordingGone"]()}</span>
        )}
        <Button variant="outline" size="sm" onClick={remove}>
          <Trash2 className="size-4" /> {m["moment.delete"]()}
        </Button>
        {share && (
          <>
            <MomentStateIcon state={share.state} host={share.host} />
            <ShareMomentButton {...share} />
          </>
        )}
      </div>

      {readOnly && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {m["moment.sharedFrom"]({ device: moment.sharedFrom })}
        </p>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        {m["moment.captured"]({ at: fmtDate(moment.createdAt, "dateTime") })}
      </p>
    </div>
  );
}
