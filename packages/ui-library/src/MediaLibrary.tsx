// MediaLibrary.tsx — the catalogue: the current section's files as a tree down the side, its
// contents in the middle; the songs are a screen of their own, a table (SongsLibrary.tsx).
// The host's nav picks the section, through the URL under its prefix.
// What it shows of the volume is useLibraryData's; the tree's rows and menus are libraryTree and
// treeActions. Must sit inside `MediaPlayback`, which owns the transport and the destination.

import { Button } from "@frediverse/ui/button";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import { Cloud, FolderTree } from "@frediverse/ui/icons";
import { RECORDINGS_DIR } from "@studio/mediatek/types";
import { sortNodes } from "@studio/web-protocol/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecording } from "./AddRecording";
import { library } from "./api";
import { useLibraryHost } from "./host";
import { EmptyBlock, LibraryContents } from "./LibraryContents";
import { LibraryPage } from "./LibraryPage";
import { remoteRows, TOP_LEVEL, treeOf } from "./libraryTree";
import { Playlists } from "./Playlists";
import { RecordingsCalendar } from "./RecordingsCalendar";
import { DEFAULT_SECTION, type SectionId } from "./routes";
import { RemoteDownload, useServerCopy } from "./ServerCopy";
import { SongsLibrary } from "./SongsLibrary";
import { assetActions } from "./treeActions";
import { useLibraryData } from "./useLibraryData";
import { useLibraryRoute } from "./useLibraryRoute";

export function MediaLibrary({
  vimMode = false,
  onOpenSettings,
  onCounts,
}: {
  vimMode?: boolean;
  /** Where the hunt's missing configuration is fixed — the host's settings page. */
  onOpenSettings: () => void;
  /** Each section's count, for a host whose nav shows them. */
  onCounts?: (counts: Partial<Record<string, number>>) => void;
}) {
  const { labels, prefix, recordButton } = useLibraryHost();
  // The screen is mirrored in the URL both ways, and the URL is the one that holds it — see routes.ts.
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [file, setFile] = useState<string | null>(null);
  useLibraryRoute(
    { section, file },
    useCallback((next) => {
      setSection(next.section);
      setFile(next.file);
    }, []),
    prefix,
  );
  // The capture zone is a section with no family behind it: no `/list`, no entries, no module pane.
  const isZone = section === RECORDINGS_DIR;
  // The set lists: a root zone with no family behind it either, and its own two-column screen.
  const isPlaylists = section === "playlists";
  // The tree's drawer on a narrow screen. Closed to begin with: arriving, you want the content.
  const [treeOpen, setTreeOpen] = useState(false);
  // The songs have no tree: a table, then a song's page, each the page's whole column (../docs/library.md).
  const isSongs = section === "songs";
  // Two sections refuse the tree's writes, and each has a header button instead (../docs/library.md).
  const editable = !isSongs;
  const {
    present,
    manage,
    counts,
    entries,
    unlisted,
    recordings,
    error,
    setError,
    notice,
    refresh,
  } = useLibraryData(section);
  // Where each entry lives on a machine paired with a server — ../../mediatek/docs/serverCopy.md.
  const serverCopy = useServerCopy(section, entries, setError);
  useEffect(() => onCounts?.(counts), [counts, onCounts]);
  // The drawer closes with the section it was opened on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the section changing
  useEffect(() => setTreeOpen(false), [section]);
  // The paired server's entries this machine lacks, filed in the same tree rather than listed apart (../docs/library.md).
  const remote = useMemo(
    () => serverCopy.placement?.serverOnly ?? [],
    [serverCopy.placement],
  );
  const remoteAt = useMemo(
    () => remoteRows(entries, remote),
    [entries, remote],
  );
  // Derived, never stored, and it synthesises the zone's own root row (../docs/library.md).
  const tree = useMemo<TreeNode[]>(
    () => [
      {
        name: section.toUpperCase(),
        path: "",
        dir: true,
        // Alphabetical all the way down: a listing arrives in scan order, which nobody can look something up in.
        children: sortNodes(treeOf(entries, unlisted, remote)),
      },
    ],
    [entries, section, unlisted, remote],
  );
  /** Where a drop lands, family-relative: the section, plus the folder the drop resolved to. */
  const assetsTarget = useCallback(
    (dir: string): string => (dir ? `${section}/${dir}` : section),
    [section],
  );
  /** Open the screen on a file, a song's sidecar or a set list, or close it. The URL is the only writer. */
  const openFile = useCallback((rel: string | null) => {
    setFile(rel);
    // The drawer closes on what was just opened: it covers the screen it was asked to reveal.
    setTreeOpen(false);
  }, []);
  // The folder PICKER beside the drag: `webkitdirectory` is the input's property, not the click's (../docs/library.md).
  const pickRef = useRef<HTMLInputElement>(null);
  // The RESOLVED target, not the row that was clicked, so the picker and the drop land in the same place.
  const pickInto = useRef<string>("");
  const pickFolder = (dir: string) => {
    pickInto.current = assetsTarget(dir);
    if (pickRef.current) pickRef.current.value = ""; // else picking the same folder twice fires no `change`
    pickRef.current?.click();
  };

  // Every section is titled the way the host's nav names it, with the same count (./LibraryPage.tsx).
  const title = labels.sections[section];
  const count = counts[section];

  // Its own two columns — the set lists, then the open one (../docs/playlists.md).
  if (isPlaylists)
    return (
      <LibraryPage fill title={title} count={count}>
        <Playlists file={file} vimMode={vimMode} onOpen={openFile} />
      </LibraryPage>
    );

  // The songs: the table, or the song opened from it, and nothing beside either (../docs/library.md).
  if (isSongs)
    return (
      <SongsLibrary
        file={file}
        openFile={openFile}
        title={title}
        count={count}
        entries={entries}
        remote={remote}
        present={present}
        manage={manage}
        notice={notice}
        error={error}
        setError={setError}
        refresh={refresh}
        serverCopy={serverCopy}
        onOpenSettings={onOpenSettings}
      />
    );

  // The captures: a calendar and the day's timeline, as the rehearsal sessions have (../docs/recordings.md).
  if (isZone)
    return (
      <LibraryPage title={title} count={count}>
        <RecordingsCalendar
          days={recordings}
          error={error}
          notice={notice}
          manage={manage}
          onChanged={refresh}
          onError={setError}
          addButton={<AddRecording onDone={refresh} onError={setError} />}
          empty={
            <EmptyBlock
              actions={
                <>
                  {recordButton}
                  <AddRecording onDone={refresh} onError={setError} />
                </>
              }
            >
              {present === false
                ? labels.contents.emptyLibrary
                : labels.contents.noRecordings}
            </EmptyBlock>
          }
        />
      </LibraryPage>
    );

  return (
    <LibraryPage fill title={title} count={count}>
      <div className="relative flex min-h-0 flex-1">
        {/* The tree's drawer button, on a narrow screen only — see ../docs/responsive.md. */}
        {!treeOpen ? (
          <Button
            variant="secondary"
            size="icon"
            className="absolute bottom-3 left-3 z-20 md:hidden"
            aria-label={labels.tree.open}
            onClick={() => setTreeOpen(true)}
          >
            <FolderTree className="h-5 w-5" />
          </Button>
        ) : null}
        {/* The drawer's veil, which exists only while it is open: an invisible cover swallows clicks. */}
        {treeOpen && (
          <button
            type="button"
            aria-label={labels.tree.close}
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setTreeOpen(false)}
          />
        )}
        {/* A column when there is room and a DRAWER when there is not, same markup — see ../docs/responsive.md. */}
        <aside
          // No translate (breaks FileTree's popup, ../docs/responsive.md) — a column, so the tree scrolls and the foot does not.
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl bg-tree-panel p-3 md:static md:z-auto md:mb-3 md:flex md:w-[290px] ${
            treeOpen ? "fixed inset-y-0 left-0 z-40 w-72 shadow-xl" : "hidden"
          }`}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <input
              ref={pickRef}
              type="file"
              multiple
              // @ts-expect-error — the directory picker is prefixed and absent from React's typings.
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []).map((file) => ({
                  path: file.webkitRelativePath || file.name,
                  file,
                }));
                // Already section-prefixed and mapped through `assetsTarget` — `pickFolder` is the only writer.
                const target = pickInto.current;
                e.target.value = "";
                if (files.length)
                  void library
                    .uploadTree(target, files)
                    .then(refresh)
                    .catch((err: Error) => setError(err.message));
              }}
            />
            <FileTree
              nodes={tree}
              // The family IS the root: every node path below is relative to it.
              rootPath=""
              rootLabel={section.toUpperCase()}
              // The section label wraps every row here — a header, not a real row to draw.
              collapseSingleRoot
              // Only the top level unfolds: nothing in a tree family opens a page of its own.
              reveal={TOP_LEVEL}
              // An entry only on the server wears a cloud.
              icon={(n) =>
                remoteAt.entries.has(n.path) ? (
                  <Cloud className="h-4 w-4 shrink-0" />
                ) : null
              }
              // Muted and not openable until it is here — still right-clickable, for its download.
              isDisabled={(n) => remoteAt.entries.has(n.path)}
              // A folder holding only the server's entries says so beside its name.
              nameEnd={(n) =>
                remoteAt.folders.has(n.path) ? (
                  <Cloud className="ml-1 inline size-3 shrink-0 text-muted-foreground" />
                ) : null
              }
              // …and an entry of the server's alone brings itself down in one click.
              rowEnd={(n) =>
                remoteAt.entries.has(n.path) ? (
                  <RemoteDownload
                    path={`${section}/${n.path}`}
                    onDownload={serverCopy.download}
                  />
                ) : null
              }
              // Undefined rather than a no-op where nothing may be dropped (../docs/library.md).
              onDropTree={
                editable
                  ? (dir, files) =>
                      void library
                        .uploadTree(assetsTarget(dir), files)
                        .then(refresh)
                        .catch((e: Error) => setError(e.message))
                  : undefined
              }
              // Present, so rows are draggable — folders included, since `moveEntry` renames a directory too.
              // A folder moved is an admin's; the service refuses it otherwise (apps/k7/backend/docs/media/gate.md).
              canMove={(n) => manage || !n.dir}
              onMove={
                editable
                  ? (from, toDir) =>
                      void library
                        .move(
                          `${section}/${from}`,
                          // Through the same mapping a drop goes through, or the two would disagree.
                          `${assetsTarget(toDir)}/${from.split("/").pop()}`,
                        )
                        .then(refresh)
                        .catch((e: Error) => setError(e.message))
                  : undefined
              }
              cancelLabel={labels.common.cancel}
              rowMenuLabel={labels.tree.more}
              // Every target needs one action whose `when` passes, or no menu opens at all (../docs/library.md).
              actions={
                !editable
                  ? []
                  : assetActions({
                      section,
                      entries,
                      assetsTarget,
                      pickFolder,
                      refresh,
                      setError,
                      labels,
                      manage,
                    })
              }
            />
          </div>
        </aside>

        <LibraryContents
          notice={notice}
          error={error}
          present={present}
          entries={entries}
          serverCopy={serverCopy}
          onOpen={openFile}
          className="pb-3 md:pl-6"
        />
      </div>
    </LibraryPage>
  );
}
