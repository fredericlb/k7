// RecorderParts.tsx — the recorder's self-contained pieces: the bar it lives in, the highlight chips, the review row, the metronome.
// Each keeps its own draft, so typing a comment or a tempo re-renders that piece and not the whole recorder.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Circle,
  Diamond,
  Metronome as MetronomeIcon,
  Pause,
  Play,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fmtTime } from "./format";
import type { RecorderLabels } from "./labels";
import type { PendingAnnotation } from "./RecorderView";
import { TagInput } from "./TagInput";
import type { DetectedEvent, Metronome } from "./types";

/** The whole recorder, a bar at the foot of the page: it stays MOUNTED, which is what keeps the take running. */
export function RecorderBar({
  paused,
  time,
  review,
  notice,
  highlights,
  actions,
  labels: L,
  children,
}: {
  paused: boolean;
  time: number;
  /** The row a highlight being listened to opens above the bar. */
  review?: ReactNode;
  /** An error, the upload's progress, or what to do about a failed one. */
  notice?: ReactNode;
  /** The highlight chips, under the waveform once there are some. */
  highlights?: ReactNode;
  /** At the bar's right: the metronome, Pause or Resume, Stop. */
  actions: ReactNode;
  labels: RecorderLabels;
  children: ReactNode;
}) {
  const bar = useRef<HTMLElement>(null);
  // Its height, as `--rec-bar-h` on the page: what the host pads its pages and stacks its own bars by.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement.style;
    const say = () => root.setProperty("--rec-bar-h", `${el.offsetHeight}px`);
    say();
    const watch = new ResizeObserver(say);
    watch.observe(el);
    return () => {
      watch.disconnect();
      root.removeProperty("--rec-bar-h");
    };
  }, []);
  return (
    <section ref={bar} className="rec-bar" aria-label={L.recorder}>
      {review && <div className="rec-bar-review">{review}</div>}
      {notice && <div className="rec-bar-notice">{notice}</div>}
      <div className="rec-bar-main">
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
        <div className="rec-bar-actions">{actions}</div>
      </div>
      {highlights}
    </section>
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

  // One row over the bar: what is heard and where, then what to note about it.
  return (
    <div className="rec-review">
      <Button size="sm" variant="outline" onClick={onToggle}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        {playing ? L.pause : L.play}
      </Button>
      <span className="rec-review-what">
        {L.reviewing(fmtTime(moment.startSec), fmtTime(moment.endSec))}
        <span className="muted small tabular"> · {fmtTime(time)}</span>
      </span>
      <Input
        className="rec-review-comment"
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
      <Button size="sm" disabled={empty} onClick={add}>
        {L.add}
      </Button>
      {notes.map((p, i) => (
        <span key={i} className="rec-review-note" title={p.text}>
          {p.tags.map((t) => (
            <Badge key={t} variant="tag">
              #{t}
            </Badge>
          ))}
          {p.text && <span className="annotation-text">{p.text}</span>}
        </span>
      ))}
    </div>
  );
}

/** The moments detected so far, as chips along the bar; picking one pauses the take to listen back. */
export function HighlightChips({
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
  const row = useRef<HTMLUListElement>(null);
  // The newest is the one just played: kept in view as the take grows, never yanked back while one is heard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the clock it runs on.
  useEffect(() => {
    const el = row.current;
    if (el && active == null) el.scrollLeft = el.scrollWidth;
  }, [highlights.length]);
  if (!highlights.length)
    return <p className="rec-chips-empty muted small">{L.keepPlaying}</p>;
  return (
    <ul ref={row} className="rec-chips" aria-label={L.highlights}>
      {highlights.map((h) => (
        <li key={h.startSec}>
          <button
            type="button"
            className={`rec-chip${active === h.startSec ? " is-active" : ""}`}
            aria-pressed={active === h.startSec}
            title={L.listenAndTag}
            onClick={() => onPick(h)}
          >
            {active === h.startSec ? (
              <Play className="size-3" />
            ) : (
              <Diamond className="size-3" />
            )}
            <span className="tabular">
              {fmtTime(h.startSec)}–{fmtTime(h.endSec)}
            </span>
            {tagged.some((p) => p.startSec === h.startSec) && (
              <span className="rec-chip-tagged" title={L.taggedBadge}>
                #
              </span>
            )}
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
