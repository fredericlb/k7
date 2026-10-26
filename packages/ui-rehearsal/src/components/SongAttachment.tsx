// SongAttachment.tsx — one of a song's lyrics, tablature or sheets, drawn read-only exactly as the
// songbook draws it, for a page outside the rehearsal screens: the médiathèque's song screen hands
// it the content (packages/ui-library/docs/songPlayer.md). Its own stylesheet scope comes with it.

import { ChordSheet, timecodesByLine } from "@studio/lyrics";
import { Tablature } from "@studio/tablature";
import { useMemo } from "react";
import type { SheetFile } from "../types";
import { SheetPanel } from "./SheetPanel";
import "../styles/index.css";

export interface SongAttachmentProps {
  kind: "lyrics" | "tablature" | "sheet";
  /** The lyrics or the tablature; ignored for the sheet. */
  text: string;
  sheets: SheetFile[];
  /** Where a sheet's bytes are read from, by its id. */
  sheetUrl: (id: string) => string;
}

export function SongAttachment({
  kind,
  text,
  sheets,
  sheetUrl,
}: SongAttachmentProps) {
  // The timecodes are read the way the songbook reads them, so a timed line shows as timed.
  const timings = useMemo(
    () => (kind === "lyrics" ? timecodesByLine(text) : undefined),
    [kind, text],
  );
  return (
    <div className="rehearsal-root song-attachment">
      {kind === "sheet" ? (
        <SheetPanel sheets={sheets} urlFor={sheetUrl} />
      ) : kind === "lyrics" ? (
        <ChordSheet text={text} transpose={0} timings={timings} />
      ) : (
        <Tablature text={text} />
      )}
    </div>
  );
}
