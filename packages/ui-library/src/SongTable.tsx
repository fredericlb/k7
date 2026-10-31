// SongTable.tsx — the songs family as a table across the page's column: the practice list, then the
// favorites, then the rest, an album of several songs as one row that unfolds into them. A song's
// row opens its page; a file dropped on it becomes its master or a version, as the tree's did. The
// search box at its head narrows it to the rows whose artist, album or title hold every word typed.
// The grouping is songRows.ts; the ⋮ is the tree's own menu (RowMenu.tsx). See ../docs/library.md.

import type { TreeAction, TreeNode } from "@frediverse/ui/file-tree";
import {
  ChevronDown,
  ChevronRight,
  Disc3,
  ListMusic,
  Search,
  X,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frediverse/ui/table";
import type { MediatekEntry } from "@studio/mediatek/types";
import { type DragEvent, Fragment, useState } from "react";
import { useLabels } from "./host";
import { PracticeMark, StarredMark } from "./ListMarks";
import { RowMenu, rowTarget } from "./RowMenu";
import { PlacementIcon, RemoteDownload } from "./ServerCopy";
import type { AlbumRow, GroupId, SongRow, TableGroup } from "./songRows";
import type { SongPlace } from "./songSource";

export interface SongTableProps {
  /** Already narrowed by the search (songRows.ts's `filterTable`). */
  groups: TableGroup[];
  /** What the search box holds, kept by the host so it outlives a visit to a song's page. */
  query: string;
  onQuery: (query: string) => void;
  practice: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
  togglePractice: (path: string) => void;
  toggleFavorite: (path: string) => void;
  actions: TreeAction<TreeNode>[];
  onOpen: (entry: MediatekEntry) => void;
  /** Audio dropped on a song of this machine, `rel` family-relative. */
  onDrop: (rel: string, files: File[]) => void;
  onDownload: (paths: string[]) => Promise<void>;
  /** Where each song is, family-prefixed path in; null on an unpaired machine, which draws the plain glyph. */
  placeOf?: (path: string) => SongPlace | null;
  /** The paired server, for the icon's tooltip. */
  server?: string | null;
  /** The server's songs open too, read from there on demand (the phone). */
  openRemote?: boolean;
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

/** A group's band: practice in the blue of its mark, favorites in the amber of their star. */
const GROUPS: Record<GroupId, { head: string; text: string; row: string }> = {
  practice: {
    head: "bg-blue-950/80",
    text: "text-blue-300/80",
    row: "bg-blue-950/40 hover:bg-blue-900/50 has-aria-expanded:bg-blue-900/50",
  },
  favorites: {
    head: "bg-yellow-950/80",
    text: "text-yellow-300/80",
    row: "bg-yellow-950/40 hover:bg-yellow-900/50 has-aria-expanded:bg-yellow-900/50",
  },
  others: { head: "", text: "text-muted-foreground", row: "" },
};

export function SongTable(p: SongTableProps) {
  const l = useLabels();
  const t = l.table;
  // Which albums are unfolded — this screen's, forgotten on leaving it like a tree's expansion.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // While searching an album shows what matched, unfolded; these are the ones folded by hand, for this query only.
  const [shut, setShut] = useState<{
    query: string;
    rels: ReadonlySet<string>;
  }>({ query: "", rels: new Set() });
  const searching = p.query.trim() !== "";
  const isOpen = (rel: string) =>
    searching ? !(shut.query === p.query && shut.rels.has(rel)) : open.has(rel);
  const flip = (set: ReadonlySet<string>, rel: string) => {
    const next = new Set(set);
    if (!next.delete(rel)) next.add(rel);
    return next;
  };
  const toggle = (rel: string) =>
    searching
      ? setShut((s) => ({
          query: p.query,
          rels: flip(s.query === p.query ? s.rels : new Set(), rel),
        }))
      : setOpen((s) => flip(s, rel));
  const heading = {
    practice: t.practice,
    favorites: t.favorites,
    others: t.others,
  };

  const marks = (rel: string) => {
    const path = `songs/${rel}`;
    return (
      <span className="flex items-center justify-end">
        {p.practice.has(path) ? (
          <PracticeMark onRemove={() => p.togglePractice(path)} />
        ) : null}
        {p.favorites.has(path) ? (
          <StarredMark onUnstar={() => p.toggleFavorite(path)} />
        ) : null}
      </span>
    );
  };

  /** Where the song is, as the workspace list says it; the plain glyph on an unpaired machine. */
  const glyph = (s: SongRow) => {
    const place = p.placeOf?.(`songs/${s.rel}`) ?? (s.remote ? "server" : null);
    return place ? (
      <span className="inline-flex w-4 shrink-0 justify-center">
        <PlacementIcon state={place} server={p.server ?? null} />
      </span>
    ) : (
      <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
    );
  };

  const songRow = (s: SongRow, inAlbum: boolean, tint: string) => {
    // A server song opens on the phone, read from there; elsewhere it waits for its download.
    const closed = s.remote && !p.openRemote;
    return (
      <TableRow
        key={s.rel}
        className={`cursor-pointer ${tint} ${s.remote ? "text-muted-foreground" : ""}`}
        onClick={() => (closed ? undefined : p.onOpen(s.entry))}
        onDragOver={(e) => {
          if (!s.remote && hasFiles(e)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (s.remote || !hasFiles(e)) return;
          e.preventDefault();
          p.onDrop(s.rel, Array.from(e.dataTransfer.files));
        }}
      >
        <TableCell className={inAlbum ? "pl-10" : undefined}>
          <span className="flex min-w-0 items-center gap-2">
            {glyph(s)}
            {/* The title is the row's keyboard way in; the row itself answers the mouse. */}
            <button
              type="button"
              disabled={closed}
              className="min-w-0 truncate text-left"
              onClick={(e) => {
                e.stopPropagation();
                p.onOpen(s.entry);
              }}
            >
              {inAlbum && typeof s.entry.meta?.track === "number"
                ? `${String(s.entry.meta.track).padStart(2, "0")} · ${s.title}`
                : s.title}
            </button>
            {s.entry.meta?.catalogued === false ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {l.contents.notCatalogued}
              </span>
            ) : null}
          </span>
          {/* On a phone the artist goes under the title rather than in a column of its own. */}
          {!inAlbum ? (
            <span className="block truncate text-xs text-muted-foreground sm:hidden">
              {s.artist}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="hidden truncate text-muted-foreground sm:table-cell">
          {inAlbum ? null : s.artist}
        </TableCell>
        <TableCell className="hidden truncate text-muted-foreground md:table-cell">
          {inAlbum ? null : s.album}
        </TableCell>
        <TableCell className="w-20">{marks(s.rel)}</TableCell>
        <TableCell className="w-10 text-right">
          {s.remote ? (
            <RemoteDownload path={`songs/${s.rel}`} onDownload={p.onDownload} />
          ) : (
            <RowMenu
              target={rowTarget(s.rel, s.title)}
              actions={p.actions}
              label={l.tree.more}
              cancelLabel={l.common.cancel}
            />
          )}
        </TableCell>
      </TableRow>
    );
  };

  const albumRow = (a: AlbumRow, tint: string) => {
    const unfolded = isOpen(a.rel);
    const Chevron = unfolded ? ChevronDown : ChevronRight;
    return (
      <Fragment key={a.rel}>
        <TableRow
          className={`cursor-pointer ${tint} ${a.remote ? "text-muted-foreground" : ""}`}
          onClick={() => toggle(a.rel)}
        >
          <TableCell>
            <span className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                aria-expanded={unfolded}
                aria-label={unfolded ? t.fold(a.title) : t.unfold(a.title)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(a.rel);
                }}
              >
                <Chevron className="h-4 w-4 shrink-0" />
                <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{a.title}</span>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t.songs(a.songs.length)}
              </span>
            </span>
            <span className="block truncate pl-12 text-xs text-muted-foreground sm:hidden">
              {a.artist}
            </span>
          </TableCell>
          <TableCell className="hidden truncate text-muted-foreground sm:table-cell">
            {a.artist}
          </TableCell>
          <TableCell className="hidden truncate text-muted-foreground md:table-cell">
            {a.title}
          </TableCell>
          <TableCell className="w-20">{marks(a.rel)}</TableCell>
          <TableCell className="w-10 text-right">
            <RowMenu
              target={rowTarget(a.rel, a.title)}
              actions={p.actions}
              label={l.tree.more}
              cancelLabel={l.common.cancel}
            />
          </TableCell>
        </TableRow>
        {unfolded ? a.songs.map((s) => songRow(s, true, tint)) : null}
      </Fragment>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          {/* Text and not `search`: Chrome draws its own clear button there, a second one beside ours. */}
          <Input
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            // Escape empties it, the way a search field is left.
            onKeyDown={(e) => {
              if (e.key === "Escape" && p.query) {
                e.preventDefault();
                p.onQuery("");
              }
            }}
            placeholder={t.search}
            aria-label={t.search}
            className="pr-8 pl-8"
          />
          {p.query ? (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={t.clearSearch}
              title={t.clearSearch}
              onClick={() => p.onQuery("")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {/* touch-manipulation: no double-tap zoom, since a double tap on a song plays it. */}
      {/* A 10% hairline: the group's band is what divides the table, not the line. */}
      <Table className="table-fixed touch-manipulation [&_tr]:border-white/10">
        <TableHeader>
          <TableRow>
            <TableHead>{t.title}</TableHead>
            <TableHead className="hidden sm:table-cell">{t.artist}</TableHead>
            <TableHead className="hidden md:table-cell">{t.album}</TableHead>
            <TableHead className="w-20" />
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.groups.map((g) => {
            const band = GROUPS[g.id];
            return (
              <Fragment key={g.id}>
                {/* The same cells as a song row, no colSpan: one spanning hidden columns would add empty ones. */}
                <TableRow className={`hover:bg-transparent ${band.head}`}>
                  <TableCell
                    className={`pt-5 text-xs font-semibold uppercase tracking-wide ${band.text}`}
                  >
                    {heading[g.id]}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="hidden md:table-cell" />
                  <TableCell />
                  <TableCell />
                </TableRow>
                {g.rows.map((r) =>
                  r.kind === "album"
                    ? albumRow(r, band.row)
                    : songRow(r, false, band.row),
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {/* A search that keeps nothing says so, under the header rather than in a row spanning the table. */}
      {searching && !p.groups.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t.noMatch(p.query.trim())}
        </p>
      ) : null}
    </div>
  );
}
