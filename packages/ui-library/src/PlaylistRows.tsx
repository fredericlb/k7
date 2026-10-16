// PlaylistRows.tsx — the graphical half of a set list: every line resolved against the songs
// catalogue, reorderable, and a search field that adds one. Every button here edits the TEXT and
// hands it back — the buffer is the document, see ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  ArrowDown,
  ArrowUp,
  CloudDownload,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  X,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  itemLabel,
  itemProblem,
  type ResolvedItem,
  songMatches,
  songRef,
} from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useMemo, useState } from "react";
import { useLabels } from "./host";

/** How many results the field shows: enough to recognise one, few enough not to become the screen. */
const HITS = 8;

/** A song's alternative versions, as the sidecar declares them — the pills beside a search hit. */
const variantsOf = (e: MediatekEntry): string[] =>
  (e.variants ?? []).filter((v) => v.kind === "file").map((v) => v.name);

/** The file a line plays — what `onPlay` starts, so the one to compare with what is sounding. */
export const rowPath = (r: ResolvedItem) =>
  r.song && r.take?.file ? `${r.song.path}/${r.take.file}` : null;

export interface PlaylistRowsProps {
  rows: ResolvedItem[];
  /** Null while the catalogue is loading — which is a different sentence from "no such song". */
  songs: MediatekEntry[] | null;
  /** How many lines only the paired server can play; 0 when unpaired or when nothing is missing. */
  missing: number;
  onDownloadMissing: () => Promise<unknown>;
  onAdd: (song: string, variant?: string) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  /** Why reordering is off, or "" — an inline `items: [a, b]` is a shape the text edits cannot take. */
  frozen: string;
  onPlay: (r: ResolvedItem) => void;
  /** The path sounding right now, or null: its row's play button reads Pause and calls `onPause`. */
  playingPath: string | null;
  onPause: () => void;
  onQueueAll: () => void;
}

export function PlaylistRows({
  rows,
  songs,
  missing,
  onDownloadMissing,
  onAdd,
  onRemove,
  onMove,
  frozen,
  onPlay,
  playingPath,
  onPause,
  onQueueAll,
}: PlaylistRowsProps) {
  const labels = useLabels();
  const l = labels.playlists;
  const c = labels.common;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  const hits = useMemo(() => {
    if (!query.trim() || !songs) return [];
    return songs.filter((e) => songMatches(e, query)).slice(0, HITS);
  }, [query, songs]);

  const add = (e: MediatekEntry, variant?: string) => {
    onAdd(songRef(e), variant);
    // The field STAYS open: building a set list means adding eight songs in a row.
    setQuery("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <Button
          variant={searching ? "default" : "secondary"}
          size="sm"
          onClick={() => setSearching((s) => !s)}
        >
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{l.search}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!rows.length}
          onClick={onQueueAll}
          title={l.queueAllTitle}
        >
          <ListPlus className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{l.queueAll}</span>
        </Button>
        {missing > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={downloading}
            title={labels.contents.downloadMissing(missing)}
            aria-busy={downloading}
            onClick={() => {
              setDownloading(true);
              void onDownloadMissing().finally(() => setDownloading(false));
            }}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin sm:mr-1" />
            ) : (
              <CloudDownload className="h-4 w-4 sm:mr-1" />
            )}
            <span className="hidden sm:inline">
              {labels.contents.downloadMissing(missing)}
            </span>
          </Button>
        ) : null}
        <span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
          {l.songCount(rows.length)}
        </span>
      </div>

      {/* ABOVE the list and not over it: what you are filling stays visible while it grows. */}
      {searching ? (
        <div className="border-b bg-muted/30 p-2">
          <Input
            autoFocus
            value={query}
            placeholder={l.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearching(false);
              if (e.key === "Enter" && hits[0]) add(hits[0]);
            }}
          />
          <ul className="mt-2 space-y-1">
            {hits.map((e) => (
              <li key={e.path} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => add(e)}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{e.name}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {String(e.meta?.artist ?? "")}
                  </span>
                </Button>
                {/* The pills add a VARIANT: without them a version means hand-editing the mapping. */}
                {variantsOf(e).map((v) => (
                  <Button
                    key={v}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => add(e, v)}
                  >
                    {v}
                  </Button>
                ))}
              </li>
            ))}
            {query.trim() && !hits.length ? (
              <li className="p-1 text-muted-foreground text-sm">{l.noMatch}</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((r, i) => {
          const problem = itemProblem(r, songs !== null);
          return (
            <li
              // The INDEX keys the row: a set list may legitimately name one song twice.
              key={`${r.item.song}:${r.item.variant ?? ""}:${i}`}
              className="flex items-center gap-1 border-b px-2 py-1.5"
            >
              <span className="w-6 shrink-0 text-muted-foreground text-xs tabular-nums">
                {i + 1}
              </span>
              {playingPath != null && playingPath === rowPath(r) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  aria-label={c.pause}
                  onClick={onPause}
                >
                  <Pause className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={!!problem}
                  aria-label={c.play}
                  onClick={() => onPlay(r)}
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{itemLabel(r)}</div>
                {/* A line resolving to nothing STAYS: a row that vanished would be an invisible typo. */}
                <div className="truncate text-muted-foreground text-xs">
                  {problem || String(r.song?.meta?.artist ?? r.item.song)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={!!frozen || i === 0}
                title={frozen || c.moveUp}
                aria-label={c.moveUp}
                onClick={() => onMove(i, i - 1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={!!frozen || i === rows.length - 1}
                title={frozen || c.moveDown}
                aria-label={c.moveDown}
                onClick={() => onMove(i, i + 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={!!frozen}
                title={frozen || c.remove}
                aria-label={c.remove}
                onClick={() => onRemove(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
        {!rows.length ? (
          <li className="p-4 text-muted-foreground text-sm">{l.empty}</li>
        ) : null}
      </ul>
    </div>
  );
}
