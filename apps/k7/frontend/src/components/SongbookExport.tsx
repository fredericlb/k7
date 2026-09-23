// The songbook's two export buttons: one file per song, zipped, downloaded.
// It owns the run's state because nothing else in the app has any use for it — the
// choices behind the two formats are in ../../../docs/export.md.

import { Button } from "@frediverse/ui/button";
import { Download } from "lucide-react";
import { useState } from "react";
import { type ExportKind, exportSongbook } from "../export/songbookZip";
import type { Song } from "../types";

interface Props {
  songs: Song[];
}

interface Running {
  kind: ExportKind;
  done: number;
  total: number;
}

export function SongbookExport({ songs }: Props) {
  const [running, setRunning] = useState<Running | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: ExportKind) => {
    setRunning({ kind, done: 0, total: songs.length });
    setNote(null);
    setError(null);
    try {
      const result = await exportSongbook(kind, songs, (done, total) =>
        setRunning({ kind, done, total }),
      );
      setNote(summarize(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const label = (kind: ExportKind, text: string) =>
    running?.kind === kind ? `${running.done}/${running.total}…` : text;

  return (
    <div className="songbook-export">
      <Button
        variant="outline"
        disabled={songs.length === 0 || running != null}
        onClick={() => run("epub")}
        title="One EPUB per song, in a zip"
      >
        <Download className="size-4" /> {label("epub", "Export EPUB")}
      </Button>
      <Button
        variant="outline"
        disabled={songs.length === 0 || running != null}
        onClick={() => run("pdf")}
        title="One PDF per song, in a zip"
      >
        <Download className="size-4" /> {label("pdf", "Export PDF")}
      </Button>
      {note && <span className="muted small">{note}</span>}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** What the run is worth saying: the file, and only the losses that actually happened. */
function summarize(result: {
  file: string;
  songs: number;
  failed: string[];
  skipped: string[];
}): string {
  const parts = [
    `${result.file} — ${result.songs} song${result.songs === 1 ? "" : "s"}`,
  ];
  if (result.failed.length > 0)
    parts.push(`${result.failed.length} failed: ${result.failed.join(", ")}`);
  if (result.skipped.length > 0)
    parts.push(`${result.skipped.length} sheet(s) left out`);
  return parts.join(" · ");
}
