// The songbook's export menu, the ⋮ at the right of the table's header: one file per song, zipped,
// downloaded. It owns the run's state because nothing else in the app has any use for it — the
// choices behind the two formats are in ../../docs/export.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Download, EllipsisVertical } from "@frediverse/ui/icons";
import { useState } from "react";
import { type ExportKind, exportSongbook } from "../export/songbookZip";
import { isOne } from "../i18n";
import { m } from "../paraglide/messages.js";
import type { SongListEntry } from "../types";

interface Props {
  songs: SongListEntry[];
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

  const busy = songs.length === 0 || running != null;

  return (
    <div className="song-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ds-button"
            title={m["export.menu"]()}
            aria-label={m["export.menu"]()}
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rehearsal-root min-w-56">
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => void run("pdf")}
            title={m["export.pdfTitle"]()}
          >
            <Download className="size-4" /> {m["export.pdf"]()}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => void run("epub")}
            title={m["export.epubTitle"]()}
          >
            <Download className="size-4" /> {m["export.epub"]()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* What the run is doing, and how it went, hangs under the button — the menu has closed by then. */}
      {(running || note || error) && (
        <div className="song-menu-status">
          {running && (
            <span className="muted small">
              {running.kind.toUpperCase()} {running.done}/{running.total}…
            </span>
          )}
          {note && <span className="muted small">{note}</span>}
          {error && <span className="error small">{error}</span>}
        </div>
      )}
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
  const n = result.songs;
  const parts = [
    `${result.file} — ${isOne(n) ? m["export.songs.one"]({ n }) : m["export.songs.other"]({ n })}`,
  ];
  if (result.failed.length > 0)
    parts.push(
      m["export.failed"]({
        n: result.failed.length,
        names: result.failed.join(", "),
      }),
    );
  if (result.skipped.length > 0)
    parts.push(m["export.skipped"]({ n: result.skipped.length }));
  return parts.join(" · ");
}
