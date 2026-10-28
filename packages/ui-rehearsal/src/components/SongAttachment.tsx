// SongAttachment.tsx — one of a song's lyrics, chords, tablature, sheets or chord diagrams, drawn for
// the médiathèque's song page: it hands over the content, the transposition and the line being sung,
// and keeps the track (packages/ui-library/docs/songPlayer.md). A tapped line starts the lead early.

import { ChordSheet, timecodesByLine } from "@studio/lyrics";
import { Tablature } from "@studio/tablature";
import { useEffect, useMemo, useRef } from "react";
import { useLyricsLead } from "../hooks/useLyricsLead";
import type { SheetFile } from "../types";
import { ChordDiagram } from "./ChordDiagram";
import { SheetPanel } from "./SheetPanel";
import "../styles/index.css";

export interface SongAttachmentProps {
  /** `chords` is a chord sheet like the lyrics, typed by hand; `diagrams` draws `chords`' fingerings. */
  kind: "lyrics" | "chords" | "tablature" | "sheet" | "diagrams";
  /** The lyrics, the chords or the tablature; ignored for the sheet and the diagrams. */
  text: string;
  sheets: SheetFile[];
  /** Where a sheet's bytes are read from, by its id. */
  sheetUrl: (id: string) => string;
  /** Remove a sheet; absent, they are drawn read-only. */
  onDeleteSheet?: (id: string) => Promise<void>;
  /** Semitones the chords, and a score, are shown shifted by. */
  transpose?: number;
  /** The timed line being sung, highlighted and scrolled into view. */
  activeLine?: number | null;
  /** A timed line tapped, in seconds; absent, timed lines are not controls. */
  onLineClick?: (seconds: number) => void;
  /** The chord symbols the diagrams draw, already transposed. */
  chords?: string[];
}

export function SongAttachment({
  kind,
  text,
  sheets,
  sheetUrl,
  onDeleteSheet,
  transpose = 0,
  activeLine = null,
  onLineClick,
  chords = [],
}: SongAttachmentProps) {
  // The timecodes are read the one way the library reads them, so a timed line shows as timed — the chords' too.
  const timings = useMemo(
    () =>
      kind === "lyrics" || kind === "chords"
        ? timecodesByLine(text)
        : undefined,
    [kind, text],
  );
  const [lead] = useLyricsLead();
  const root = useRef<HTMLDivElement>(null);
  // The sung line kept in view, centred, as it moves; nothing scrolls while no line is sung.
  useEffect(() => {
    if (activeLine === null) return;
    root.current
      ?.querySelector(".cs-active")
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLine]);

  return (
    <div ref={root} className="rehearsal-root song-attachment">
      {kind === "sheet" ? (
        <SheetPanel
          sheets={sheets}
          urlFor={sheetUrl}
          onDelete={onDeleteSheet}
          transpose={transpose}
        />
      ) : kind === "diagrams" ? (
        <div className="song-chord-grid">
          {chords.map((c) => (
            <ChordDiagram key={c} symbol={c} />
          ))}
        </div>
      ) : kind === "lyrics" || kind === "chords" ? (
        <ChordSheet
          text={text}
          transpose={transpose}
          timings={timings}
          activeLine={activeLine}
          onLineClick={
            onLineClick
              ? (t: number) => onLineClick(Math.max(0, t - lead))
              : undefined
          }
        />
      ) : (
        <Tablature text={text} />
      )}
    </div>
  );
}
