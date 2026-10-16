// SessionMoments.tsx — a session's moments, saved and detected in one list sorted by start: a
// detected span plays or is saved; a saved one is a MomentRow. Memoised against the playhead.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Diamond, Pause, Play } from "@frediverse/ui/icons";
import { useMemo } from "react";
import { fmtTime } from "../format";
import { m } from "../paraglide/messages.js";
import type {
  Annotation,
  DetectedEvent,
  Envelope,
  Selection,
  Session,
} from "../types";
import { MomentRow } from "./MomentRow";

type AnnotationPatch = {
  text?: string;
  tags?: string[];
  startSec?: number;
  endSec?: number;
};

interface Props {
  session: Session;
  events: DetectedEvent[];
  envelope: Envelope | null;
  allTags: string[];
  validating: string | null;
  momentClipUrl: (annId: string) => string;
  editing: { id: string; start: number; end: number } | null;
  playing: boolean;
  playingRange: { start: number; end: number } | null;
  onPlay: (start: number, end: number) => void;
  onPause: () => void;
  onSave: (startSec: number, endSec: number) => Promise<void>;
  onUpdate: (annId: string, patch: AnnotationPatch) => Promise<void>;
  onValidate: (annId: string) => Promise<void>;
  onDelete: (annId: string) => Promise<void>;
  onBeginEdit: (ann: Annotation) => void;
  onEditRange: (range: Selection) => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
}

export function SessionMoments(p: Props) {
  const { session, events } = p;
  // A span leaves the detected list once saved — built when they change, not on every playhead frame.
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
      ...events
        .filter((ev) => !isSavedSpan(ev))
        .map((ev) => ({
          kind: "detected" as const,
          startSec: ev.startSec,
          ev,
        })),
    ].sort((a, b) => a.startSec - b.startSec);
  }, [session.annotations, events]);

  // The list re-renders when what it SHOWS changes; the playhead moves sixty times a second and it reads none of it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: its handlers touch refs, setters and these props only.
  const list = useMemo(
    () => (
      <ul className="annotation-list">
        {momentList.map((row) =>
          row.kind === "saved" ? (
            <MomentRow
              key={`saved-${row.ann.id}`}
              ann={row.ann}
              envelope={p.envelope}
              duration={session.duration}
              allTags={p.allTags}
              validating={p.validating}
              momentClipUrl={p.momentClipUrl}
              editRange={
                p.editing?.id === row.ann.id
                  ? { start: p.editing.start, end: p.editing.end }
                  : null
              }
              onPlay={p.onPlay}
              onUpdate={p.onUpdate}
              onValidate={p.onValidate}
              onDelete={p.onDelete}
              onBeginEdit={() => p.onBeginEdit(row.ann)}
              onEditRange={p.onEditRange}
              onApplyEdit={p.onApplyEdit}
              onCancelEdit={p.onCancelEdit}
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
                {p.playing &&
                p.playingRange?.start === row.ev.startSec &&
                p.playingRange.end === row.ev.endSec ? (
                  <Button variant="outline" size="sm" onClick={p.onPause}>
                    <Pause className="size-4" /> {m["common.pause"]()}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => p.onPlay(row.ev.startSec, row.ev.endSec)}
                  >
                    <Play className="size-4" /> {m["common.play"]()}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => p.onSave(row.ev.startSec, row.ev.endSec)}
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
      p.envelope,
      session.duration,
      p.allTags,
      p.validating,
      p.momentClipUrl,
      p.editing,
      p.playing,
      p.playingRange,
      p.onUpdate,
      p.onValidate,
      p.onDelete,
      p.onSave,
    ],
  );

  return (
    <>
      <h3>
        {m["session.moments"]()}{" "}
        <span className="muted small">({momentList.length})</span>
      </h3>
      {momentList.length === 0 && (
        <p className="muted">{m["session.noMoments"]()}</p>
      )}
      {list}
    </>
  );
}
