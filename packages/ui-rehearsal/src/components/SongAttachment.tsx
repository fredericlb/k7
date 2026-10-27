// SongAttachment.tsx — one of a song's lyrics, chords, tablature or sheets, drawn exactly as the
// songbook draws it, for a page outside the rehearsal screens: the médiathèque's song screen hands
// it the content, and the way to remove a sheet when it allows one (packages/ui-library/docs/songPlayer.md).

import { ChordSheet, timecodesByLine } from "@studio/lyrics";
import { Tablature } from "@studio/tablature";
import { useMemo } from "react";
import type { SheetFile } from "../types";
import { SheetPanel } from "./SheetPanel";
import "../styles/index.css";

export interface SongAttachmentProps {
  /** `chords` is a chord sheet like the lyrics, typed by hand and kept apart from them. */
  kind: "lyrics" | "chords" | "tablature" | "sheet";
  /** The lyrics, the chords or the tablature; ignored for the sheet. */
  text: string;
  sheets: SheetFile[];
  /** Where a sheet's bytes are read from, by its id. */
  sheetUrl: (id: string) => string;
  /** Remove a sheet; absent, they are drawn read-only. */
  onDeleteSheet?: (id: string) => Promise<void>;
}

export function SongAttachment({
  kind,
  text,
  sheets,
  sheetUrl,
  onDeleteSheet,
}: SongAttachmentProps) {
  // The timecodes are read the way the songbook reads them, so a timed line shows as timed — the chords' too.
  const timings = useMemo(
    () =>
      kind === "lyrics" || kind === "chords"
        ? timecodesByLine(text)
        : undefined,
    [kind, text],
  );
  return (
    <div className="rehearsal-root song-attachment">
      {kind === "sheet" ? (
        <SheetPanel
          sheets={sheets}
          urlFor={sheetUrl}
          onDelete={onDeleteSheet}
        />
      ) : kind === "lyrics" ? (
        <ChordSheet text={text} transpose={0} timings={timings} />
      ) : kind === "chords" ? (
        <ChordSheet text={text} transpose={0} timings={timings} />
      ) : (
        <Tablature text={text} />
      )}
    </div>
  );
}
