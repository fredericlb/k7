// RecorderParts.tsx — the recorder's self-contained pieces: the collapsed bar, the moments list, the review panel, the metronome.
// Each keeps its own draft, so typing a comment or a tempo re-renders that piece and not the whole recorder.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  ChevronRight,
  Circle,
  Diamond,
  Metronome as MetronomeIcon,
  Pause,
  Play,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type ReactNode, useState } from "react";
import { fmtTime } from "./format";
import type { RecorderLabels } from "./labels";
import type { PendingAnnotation } from "./RecorderView";
import { TagInput } from "./TagInput";
import type { DetectedEvent, Metronome } from "./types";

/** The collapsed recorder: it stays MOUNTED, which is what keeps the take running. */
export function RecorderBar({
  paused,
  time,
  moments,
  tagged,
  onExpand,
  labels: L,
  children,
}: {
  paused: boolean;
  time: number;
  moments: number;
  tagged: number;
  onExpand?: () => void;
  labels: RecorderLabels;
  children: ReactNode;
}) {
  return (
    <div
      className="rec-bar"
      role="button"
      tabIndex={0}
      title={L.returnToRecording}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter") onExpand?.();
      }}
    >
      <div className="rec-bar-status">
        {paused ? (
          <Badge variant="amber">{L.paused}</Badge>
        ) : (
          <Badge variant="rec">
            <Circle className="size-2.5 fill-current" /> {L.rec}
          </Badge>
        )}
        <span className="tabular">{fmtTime(time)}</span>
      </div>

      <div className="rec-bar-wave">{children}</div>

      <div className="rec-bar-meta">
        <span title={L.detectedSoFar}>
          <Diamond className="size-3" /> {L.moments(moments)}
        </span>
        {tagged > 0 && <span className="muted small">{L.tagged(tagged)}</span>}
        <span className="ghost small rec-bar-open">
          {L.open} <ChevronRight className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

/** Listening back to one moment mid-take, and tagging it. */
export function ReviewPanel({
  moment,
  playing,
  time,
  onToggle,
  onAdd,
  suggestions,
  notes,
  labels: L,
}: {
  moment: DetectedEvent;
  playing: boolean;
  time: number;
  onToggle: () => void;
  onAdd: (text: string, tags: string[]) => void;
  suggestions: string[];
  notes: PendingAnnotation[];
  labels: RecorderLabels;
}) {
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const empty = !comment.trim() && tags.length === 0;
  const add = () => {
    if (empty) return;
    onAdd(comment.trim(), tags);
    setComment("");
    setTags([]);
  };

  return (
    <Card className="review-panel">
      <h3>{L.reviewing(fmtTime(moment.startSec), fmtTime(moment.endSec))}</h3>
      <div className="row playback-controls">
        <Button onClick={onToggle}>
          {playing ? (
            <>
              <Pause className="size-4" /> {L.pause}
            </>
          ) : (
            <>
              <Play className="size-4" /> {L.play}
            </>
          )}
        </Button>
        <span className="muted small tabular">{fmtTime(time)}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Input
          value={comment}
          placeholder={L.whatHappened}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={suggestions}
          removeLabel={L.removeTag}
        />
        <Button disabled={empty} onClick={add}>
          {L.add}
        </Button>
      </div>
      {notes.length > 0 && (
        <ul className="annotation-list" style={{ marginTop: 8 }}>
          {notes.map((p, i) => (
            <li key={i} className="annotation-item">
              {p.tags.map((t) => (
                <Badge key={t} variant="tag">
                  #{t}
                </Badge>
              ))}
              <span className="annotation-text">{p.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The moments detected so far; picking one pauses the take to listen back. */
export function HighlightList({
  highlights,
  active,
  tagged,
  onPick,
  labels: L,
}: {
  highlights: DetectedEvent[];
  active: number | null;
  tagged: PendingAnnotation[];
  onPick: (h: DetectedEvent) => void;
  labels: RecorderLabels;
}) {
  return (
    <ul className="event-list">
      {highlights.map((h, i) => (
        <li key={i}>
          <button
            type="button"
            className={`event-item link-row${active === h.startSec ? " active-row" : ""}`}
            onClick={() => onPick(h)}
          >
            <span>
              {fmtTime(h.startSec)} – {fmtTime(h.endSec)}{" "}
              <span className="muted small">({fmtTime(h.durationSec)})</span>
              {tagged.some((p) => p.startSec === h.startSec) && (
                <Badge variant="tag" className="ml-2">
                  {L.taggedBadge}
                </Badge>
              )}
            </span>
            <span className="muted small">
              <Pause className="size-3" /> {L.listenAndTag}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The tempo field and the click; a running metronome follows the field as soon as it reads as a tempo. */
export function MetronomeControls({
  metronome,
  onStart,
  onStop,
  labels: L,
}: {
  metronome: Metronome | null;
  onStart: (bpm: number) => void;
  onStop: () => void;
  labels: RecorderLabels;
}) {
  const [bpmText, setBpmText] = useState("120");
  const toggle = () => {
    if (metronome) return onStop();
    const bpm = parseBpm(bpmText);
    if (bpm != null) onStart(bpm);
  };
  const change = (t: string) => {
    setBpmText(t);
    const bpm = parseBpm(t);
    if (metronome && bpm != null && bpm !== metronome.bpm) onStart(bpm);
  };
  return (
    <>
      <Input
        type="number"
        min={20}
        max={400}
        className="recorder-bpm"
        value={bpmText}
        onChange={(e) => change(e.target.value)}
        aria-label={L.tempo}
        title={L.tempo}
      />
      <Button
        variant={metronome ? "default" : "ghost"}
        size="icon-sm"
        className="recorder-metro"
        onClick={toggle}
        disabled={!metronome && parseBpm(bpmText) == null}
        aria-pressed={metronome != null}
        aria-label={metronome ? L.metronomeStop : L.metronomeStart}
        title={metronome ? L.metronomeOn(metronome.bpm) : L.metronomeStart}
      >
        <MetronomeIcon className="size-4" />
      </Button>
    </>
  );
}

function parseBpm(t: string): number | null {
  const n = Number(t);
  return Number.isFinite(n) && n >= 20 && n <= 400 ? n : null;
}
