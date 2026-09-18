import { useMemo } from "react";
import {
  isChord,
  type ParsedLine,
  parseChordSheet,
  transposeChord,
  transposeLine,
} from "./chords";
import "./styles.css";

interface Props {
  text: string;
  /** Semitones to shift every chord by. */
  transpose?: number;
  /** When set, chords render as buttons that report the displayed symbol. */
  onChordClick?: (symbol: string) => void;
  /** Seconds each sung line starts at, by line index — ../../../docs/lyricsTiming.md. */
  timings?: ReadonlyMap<number, number>;
  /** The line being sung now, highlighted. */
  activeLine?: number | null;
  /** When set, a timed line is a control that seeks there. */
  onLineClick?: (seconds: number) => void;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// A single chord token — a button when clickable, otherwise a plain span.
function ChordToken({
  symbol,
  onChordClick,
}: {
  symbol: string;
  onChordClick?: (s: string) => void;
}) {
  if (onChordClick) {
    return (
      <button
        type="button"
        className="cs-chord cs-chord-btn"
        onClick={() => onChordClick(symbol)}
      >
        {symbol}
      </button>
    );
  }
  return <span className="cs-chord">{symbol}</span>;
}

// A "chords above lyrics" line: the tokens coloured, the spacing kept by `white-space: pre`.
function ChordLine({
  text,
  transpose,
  onChordClick,
}: {
  text: string;
  transpose: number;
  onChordClick?: (s: string) => void;
}) {
  const shifted = transposeLine(text, transpose);
  const parts = shifted.split(/(\s+)/);
  return (
    <div className="cs-chordline">
      {parts.map((part, i) =>
        /^\s+$/.test(part) || !isChord(part) ? (
          part
        ) : (
          <ChordToken key={i} symbol={part} onChordClick={onChordClick} />
        ),
      )}
    </div>
  );
}

// A lyric line: a segment with a chord stacks it above the word, a plain one stays inline.
function LyricLine({
  line,
  transpose,
  onChordClick,
  time,
  active,
  onSeek,
}: {
  line: Extract<ParsedLine, { type: "lyrics" }>;
  transpose: number;
  onChordClick?: (s: string) => void;
  time?: number;
  active?: boolean;
  onSeek?: (seconds: number) => void;
}) {
  const seekable = time !== undefined && onSeek !== undefined;
  const className = `cs-line${time !== undefined ? " cs-timed" : ""}${active ? " cs-active" : ""}`;
  // A timed line seeks the track from a click or the keyboard; the chords inside keep their own clicks.
  const seek = seekable
    ? {
        role: "button" as const,
        tabIndex: 0,
        title: clock(time),
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest(".cs-chord-btn")) return;
          onSeek(time);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSeek(time);
          }
        },
      }
    : {};
  return (
    <div className={className} {...seek}>
      {line.segments.map((seg, i) =>
        seg.chord ? (
          <span key={i} className="cs-inline">
            <ChordToken
              symbol={transposeChord(seg.chord, transpose)}
              onChordClick={onChordClick}
            />
            <span className="cs-lyric">{seg.text || " "}</span>
          </span>
        ) : (
          <span key={i} className="cs-lyric">
            {seg.text}
          </span>
        ),
      )}
    </div>
  );
}

export function ChordSheet({
  text,
  transpose = 0,
  onChordClick,
  timings,
  activeLine,
  onLineClick,
}: Props) {
  const lines = useMemo(() => parseChordSheet(text), [text]);
  return (
    <div className="cs-sheet">
      {lines.map((line, i) => {
        switch (line.type) {
          case "empty":
            return <div key={i} className="cs-empty" />;
          case "section":
            return (
              <div key={i} className="cs-section">
                {line.label}
              </div>
            );
          case "chords":
            return (
              <ChordLine
                key={i}
                text={line.text}
                transpose={transpose}
                onChordClick={onChordClick}
              />
            );
          case "lyrics":
            return (
              <LyricLine
                key={i}
                line={line}
                transpose={transpose}
                onChordClick={onChordClick}
                time={timings?.get(i)}
                active={activeLine === i}
                onSeek={onLineClick}
              />
            );
        }
      })}
    </div>
  );
}
