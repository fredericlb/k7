// SongTable.tsx — the songs family as a table the width of the screen: the practice list, then the
// favorites, then the rest, an album of several songs as one row that unfolds into them. A song's
// row opens its page; a file dropped on it becomes its master or a version, as the tree's did.
// The grouping is songRows.ts; the ⋮ is the tree's own menu (RowMenu.tsx). See ../docs/library.md.

import type { TreeAction, TreeNode } from "@frediverse/ui/file-tree";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Disc3,
  ListMusic,
} from "@frediverse/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frediverse/ui/table";
import type { MediatekEntry } from "@studio/mediatek/types";
import { type DragEvent, Fragment, type ReactNode, useState } from "react";
import { useLabels } from "./host";
import { PracticeMark, StarredMark } from "./ListMarks";
import { RowMenu, rowTarget } from "./RowMenu";
import { RemoteDownload } from "./ServerCopy";
import type { AlbumRow, SongRow, TableGroup } from "./songRows";

export interface SongTableProps {
  groups: TableGroup[];
  practice: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
  togglePractice: (path: string) => void;
  toggleFavorite: (path: string) => void;
  actions: TreeAction<TreeNode>[];
  onOpen: (entry: MediatekEntry) => void;
  /** Audio dropped on a song of this machine, `rel` family-relative. */
  onDrop: (rel: string, files: File[]) => void;
  onDownload: (paths: string[]) => Promise<void>;
  /** Above the table, at its right: what adds a song. */
  actionsBar?: ReactNode;
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

export function SongTable(p: SongTableProps) {
  const l = useLabels();
  const t = l.table;
  // Which albums are unfolded — this screen's, forgotten on leaving it like a tree's expansion.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (rel: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(rel)) next.add(rel);
      return next;
    });
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

  const songRow = (s: SongRow, inAlbum: boolean) => (
    <TableRow
      key={s.rel}
      className={`cursor-pointer ${s.remote ? "text-muted-foreground" : ""}`}
      onClick={() => (s.remote ? undefined : p.onOpen(s.entry))}
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
          {s.remote ? (
            <Cloud className="h-4 w-4 shrink-0" />
          ) : (
            <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {/* The title is the row's keyboard way in; the row itself answers the mouse. */}
          <button
            type="button"
            disabled={s.remote}
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

  const albumRow = (a: AlbumRow) => {
    const unfolded = open.has(a.rel);
    const Chevron = unfolded ? ChevronDown : ChevronRight;
    return (
      <Fragment key={a.rel}>
        <TableRow
          className={`cursor-pointer ${a.remote ? "text-muted-foreground" : ""}`}
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
        {unfolded ? a.songs.map((s) => songRow(s, true)) : null}
      </Fragment>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {p.actionsBar ? (
        <div className="flex flex-wrap justify-end gap-2">{p.actionsBar}</div>
      ) : null}
      {/* touch-manipulation: no double-tap zoom, since a double tap on a song plays it. */}
      <Table className="table-fixed touch-manipulation">
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
          {p.groups.map((g) => (
            <Fragment key={g.id}>
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {heading[g.id]}
                </TableCell>
              </TableRow>
              {g.rows.map((r) =>
                r.kind === "album" ? albumRow(r) : songRow(r, false),
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
