// MediaLibrary.tsx — the catalogue: the current section's files as a tree down the side, its
// contents in the middle. The host's nav picks the section, through the URL under its prefix.
// What it shows of the volume is useLibraryData's; the tree's rows and menus are libraryTree and
// treeActions. Must sit inside `MediaPlayback`, which owns the transport and the destination.

import { Button } from "@frediverse/ui/button";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import { Cloud, Disc3, FolderTree, Search } from "@frediverse/ui/icons";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import {
  type MediatekEntry,
  RECORDINGS_DIR,
  SONG_FILE,
} from "@studio/mediatek/types";
import { sortNodes } from "@studio/web-protocol/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecording } from "./AddRecording";
import { AddSong } from "./AddSong";
import { library } from "./api";
import { FindSongs } from "./FindSongs";
import { useLibraryHost } from "./host";
import { LibraryContents } from "./LibraryContents";
import {
  dayNodes,
  entryAt,
  isSong,
  isSongFolder,
  relative,
  remoteRows,
  TOP_LEVEL,
  treeOf,
} from "./libraryTree";
import { Playlists } from "./Playlists";
import { usePlayback } from "./playback/PlaybackProvider";
import { DEFAULT_SECTION, folderOf, type SectionId } from "./routes";
import { RemoteDownload, useServerCopy } from "./ServerCopy";
import { SongEditor } from "./SongEditor";
import { assetActions, songActions } from "./treeActions";
import { useLibraryData } from "./useLibraryData";
import { useLibraryRoute } from "./useLibraryRoute";
import { useSongTap } from "./useSongTap";

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
  const { labels, prefix } = useLibraryHost();
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
  // The hunt, showing nothing on the volume (../docs/hunt.md).
  const isFind = section === "find";
  // The set lists: a root zone with no family behind it either, and its own two-column screen.
  const isPlaylists = section === "playlists";
  // The tree's drawer on a narrow screen. Closed to begin with: arriving, you want the content.
  const [treeOpen, setTreeOpen] = useState(false);
  // Two sections refuse the tree's writes, and each has a header button instead (../docs/library.md).
  const editable = section !== "songs" && !isZone;
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
    refreshSongs,
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
        children: sortNodes(
          isZone ? dayNodes(recordings) : treeOf(entries, unlisted, remote),
        ),
      },
    ],
    [entries, isZone, recordings, section, unlisted, remote],
  );
  // DERIVED from the route rather than held beside it, so a deep link needs no replay — see ../docs/routing.md.
  const editingSong = useMemo(() => {
    // The SECTION too: a set list's address carries a file that belongs to no entry (../docs/routing.md).
    if (section !== "songs") return null;
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && isSong(entry) ? entry : null;
  }, [entries, file, section]);
  /** What is open: what the tree marks active, opens down to, and what the middle of the screen shows. */
  const opened = editingSong;
  // On a narrow screen the songs' tree IS the page until a song opens — ../docs/responsive.md.
  const treeIsPage = section === "songs" && !editingSong;
  /** Where a drop lands, family-relative: the section, plus the folder the drop resolved to. */
  const assetsTarget = useCallback(
    (dir: string): string => (dir ? `${section}/${dir}` : section),
    [section],
  );
  /** Open the screen on a song's sidecar, or close it. The URL is the only writer. */
  const openFile = useCallback((rel: string | null) => {
    setFile(rel);
    // The drawer closes on what was just opened: it covers the screen it was asked to reveal.
    setTreeOpen(false);
  }, []);
  /** What the tree is opened down to. STICKY, and it starts on TOP_LEVEL — see ../docs/library.md. */
  const [revealed, setRevealed] = useState<string | null>(TOP_LEVEL);
  const target = opened ? relative(opened.path) : null;
  useEffect(() => {
    if (target) setRevealed(target);
  }, [target]);
  // The queue and the destination are the provider's, above this screen.
  const playback = usePlayback();
  // A tap opens the song; a double tap on a touch screen plays it instead (../docs/responsive.md).
  const tapSong = useSongTap(
    useCallback(
      (entry: MediatekEntry) =>
        openFile(`${relative(entry.path)}/${SONG_FILE}`),
      [openFile],
    ),
  );

  // The folder PICKER beside the drag: `webkitdirectory` is the input's property, not the click's (../docs/library.md).
  const pickRef = useRef<HTMLInputElement>(null);
  // The RESOLVED target, not the row that was clicked, so the picker and the drop land in the same place.
  const pickInto = useRef<string>("");
  const pickFolder = (dir: string) => {
    pickInto.current = assetsTarget(dir);
    if (pickRef.current) pickRef.current.value = ""; // else picking the same folder twice fires no `change`
    pickRef.current?.click();
  };

  // The variant PICKER beside the drop, so the menu says out loud which song it is adding to.
  const variantRef = useRef<HTMLInputElement>(null);
  const variantInto = useRef<string>("");
  const pickVariant = useCallback((song: string) => {
    variantInto.current = song;
    if (variantRef.current) variantRef.current.value = ""; // else the same file twice fires no `change`
    variantRef.current?.click();
  }, []);

  /** Audio filed as VERSIONS of a song — one request each, refusals collected (../docs/library.md). */
  const addVariants = useCallback(
    async (songPath: string, files: File[]) => {
      const refused: string[] = [];
      const added: string[] = [];
      for (const file of files) {
        if (!isAudio(file.name)) {
          refused.push(labels.tree.notAudio(file.name));
          continue;
        }
        try {
          added.push(
            (await library.addVariant(`songs/${songPath}`, file)).path,
          );
        } catch (e) {
          refused.push((e as Error).message);
        }
      }
      // Before the errors below: it clears the message, and what it clears must be the OLD one.
      refresh();
      if (refused.length) setError(refused.join(" · "));
      // The waveform, the onsets and the tempo, never awaited and best effort — this service
      // decodes them itself (packages/audio-analysis/docs/analysis.md).
      for (const path of added) void library.analyse(path).catch(() => {});
    },
    [refresh, setError, labels],
  );

  /** The SONGS family's menu, and the only one it gets (../docs/library.md). */
  const songMenu = useMemo(
    () =>
      section !== "songs"
        ? []
        : songActions({
            section,
            entries,
            file,
            openFile,
            pickVariant,
            enqueue: playback.enqueue,
            serverOnly: serverCopy.placement?.serverOnly ?? [],
            download: serverCopy.download,
            refresh,
            setError,
            labels,
            manage,
          }),
    [
      manage,
      entries,
      file,
      openFile,
      pickVariant,
      playback.enqueue,
      serverCopy.placement,
      serverCopy.download,
      refresh,
      section,
      setError,
      labels,
    ],
  );

  // The hunt page draws its own scroller, because its history can be long.
  if (isFind)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <FindSongs onFiled={refreshSongs} onOpenSettings={onOpenSettings} />
      </div>
    );
  // Its own two columns — the set lists, then the open one (../docs/playlists.md).
  if (isPlaylists)
    return <Playlists file={file} vimMode={vimMode} onOpen={openFile} />;

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* The tree's drawer button, on a narrow screen only — see ../docs/responsive.md. */}
      {!treeOpen && !treeIsPage ? (
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
        // touch-manipulation: no double-tap zoom, since a double tap on a song plays it.
        className={`flex shrink-0 touch-manipulation flex-col overflow-hidden rounded-xl bg-tree-panel p-3 md:static md:z-auto md:m-3 md:flex md:w-[290px] ${
          treeIsPage
            ? "m-3 min-w-0 flex-1 md:flex-none"
            : treeOpen
              ? "fixed inset-y-0 left-0 z-40 w-72 shadow-xl"
              : "hidden"
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
          {/* …and the one the variant menu opens: that one names a directory, a variant is one audio file. */}
          <input
            ref={variantRef}
            type="file"
            accept={AUDIO_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              const song = variantInto.current;
              e.target.value = "";
              if (files.length) void addVariants(song, files);
            }}
          />
          <FileTree
            nodes={tree}
            // The family IS the root: every node path below is relative to it.
            rootPath=""
            rootLabel={section.toUpperCase()}
            // The section label wraps every row here — a header, not a real row to draw.
            collapseSingleRoot
            // The entry being edited outranks the merely selected one — same value `revealed` follows.
            activePath={target}
            // Open down to it, so a reloaded deep link lands on a tree showing where it is. Sticky.
            reveal={revealed}
            // A SONG folds nothing: its whole row opens its sidecar — see ../docs/library.md.
            opensOnName={(n) => isSongFolder(entries, n.path)}
            onOpen={(n) => {
              const entry = entryAt(entries, n.path);
              if (entry && isSong(entry)) tapSong(entry);
            }}
            // A song wears the glyph of its own tab; one only on the server, a cloud.
            icon={(n) => {
              if (remoteAt.entries.has(n.path))
                return <Cloud className="h-4 w-4 shrink-0" />;
              const e = entryAt(entries, n.path);
              return e && isSong(e) ? (
                <Disc3 className="h-4 w-4 shrink-0" />
              ) : null;
            }}
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
            // Undefined rather than a no-op where nothing may be dropped, and a tree drop for songs (../docs/library.md).
            onDropTree={
              editable
                ? (dir, files) =>
                    void library
                      .uploadTree(assetsTarget(dir), files)
                      .then(refresh)
                      .catch((e: Error) => setError(e.message))
                : section === "songs"
                  ? (dir, files) =>
                      void (isSongFolder(entries, dir)
                        ? addVariants(
                            dir,
                            files.map((f) => f.file),
                          )
                        : setError(labels.tree.dropOnSong))
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
                ? songMenu
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
        {/* Below the tree's own scroll, not inside it — a foot that never moves. */}
        {section === "songs" ? (
          <div className="mt-2 flex shrink-0 flex-col gap-2 border-t border-white/10 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSection("find")}
            >
              <Search className="mr-1 h-4 w-4" />
              {labels.tree.findSongs}
            </Button>
            <AddSong onDone={refresh} />
          </div>
        ) : isZone ? (
          <div className="mt-2 flex shrink-0 flex-col gap-2 border-t border-white/10 pt-2">
            <AddRecording onDone={refresh} onError={setError} />
          </div>
        ) : null}
      </aside>

      {/* A module view and a chain editor stood at the head of this chain of screens (../docs/library.md). */}
      {editingSong ? (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SongEditor
            entry={editingSong}
            vimMode={vimMode}
            playbackTarget={playback.target}
            onBack={() => openFile(null)}
            onSaved={refresh}
            manage={manage}
          />
        </main>
      ) : (
        <LibraryContents
          // The tree took the narrow screen, and these rows are the same songs it lists.
          narrowHidden={treeIsPage}
          notice={notice}
          error={error}
          present={present}
          isZone={isZone}
          recordings={recordings}
          entries={entries}
          serverCopy={serverCopy}
          onOpen={openFile}
          emptyActions={
            section === "songs" ? (
              <>
                <Button size="sm" onClick={() => setSection("find")}>
                  <Search className="h-4 w-4" />
                  {labels.tree.findSongs}
                </Button>
                <AddSong onDone={refresh} />
              </>
            ) : isZone ? (
              <AddRecording onDone={refresh} onError={setError} />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
