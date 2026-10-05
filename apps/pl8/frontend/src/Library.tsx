// Library.tsx — the catalogue: the sections as header tabs (the families and the raw capture
// zone), the current one's files as a tree down the side, its contents in the middle. What it
// shows of the volume is useLibraryData's; the tree's rows and menus are libraryTree and
// treeActions. The chrome follows st0 — same shell, same tree.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import { Disc3, FolderTree, Search } from "@frediverse/ui/icons";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import { RECORDINGS_DIR, SONG_FILE } from "@studio/mediatek/types";
import { UserMenu } from "@studio/ui-user-menu";
import { sortNodes } from "@studio/web-protocol/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecording } from "./AddRecording";
import { AddSong } from "./AddSong";
import { auth, currentUser, library } from "./api";
import { FindSongs } from "./FindSongs";
import { LibraryContents } from "./LibraryContents";
import {
  dayNodes,
  entryAt,
  isSong,
  isSongFolder,
  relative,
  TOP_LEVEL,
  treeOf,
} from "./libraryTree";
import { Playlists } from "./Playlists";
import { MiniPlayer } from "./playback/MiniPlayer";
import { PlaybackPicker } from "./playback/PlaybackPicker";
import { PlaybackProvider } from "./playback/PlaybackProvider";
import { QueueAdvance } from "./playback/QueueAdvance";
import { usePlaybackTarget } from "./playback/usePlaybackTarget";
import { usePlayQueue } from "./playback/usePlayQueue";
import { DEFAULT_SECTION, folderOf, type SectionId } from "./routes";
import { sectionItems, sectionLabel } from "./SectionNav";
import { SettingsPage } from "./SettingsPage";
import { SongEditor } from "./SongEditor";
import { assetActions, songActions } from "./treeActions";
import { useLibraryData } from "./useLibraryData";
import { useLibraryRoute } from "./useLibraryRoute";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export function Library() {
  // The screen is mirrored in the URL both ways, and the URL is the one that holds it — see routes.ts.
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [file, setFile] = useState<string | null>(null);
  useLibraryRoute(
    { section, file },
    useCallback((next) => {
      setSection(next.section);
      setFile(next.file);
    }, []),
  );
  // The capture zone is a section with no family behind it: no `/list`, no entries, no module pane.
  const isZone = section === RECORDINGS_DIR;
  // « Trouver des morceaux » — a tabless section reached by a button, showing nothing on the volume (../docs/hunt.md).
  const isFind = section === "find";
  // « Paramètres » — tabless too, reached from the cog (../docs/settings.md).
  const isSettings = section === "settings";
  // The set lists: a root zone with no family behind it either, and its own two-column screen.
  const isPlaylists = section === "playlists";
  /** Is there a tree beside it? Derived here because the HEADER needs it: the drawer button is up there. */
  const hasTree = !isFind && !isPlaylists && !isSettings;
  // The tree's drawer on a narrow screen. Closed to begin with: arriving, you want the content.
  const [treeOpen, setTreeOpen] = useState(false);
  // Two sections refuse the tree's writes, and each has a header button instead (../docs/library.md).
  const editable = section !== "songs" && !isZone;
  const {
    present,
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
  // The drawer closes with the section it was opened on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the section changing
  useEffect(() => setTreeOpen(false), [section]);
  // Derived, never stored, and it synthesises the zone's own root row (../docs/library.md).
  const tree = useMemo<TreeNode[]>(
    () => [
      {
        name: section.toUpperCase(),
        path: "",
        dir: true,
        // Alphabetical all the way down: a listing arrives in scan order, which nobody can look something up in.
        children: sortNodes(
          isZone ? dayNodes(recordings) : treeOf(entries, unlisted),
        ),
      },
    ],
    [entries, isZone, recordings, section, unlisted],
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
  // Where sound comes out. Held here because the editors below need it too.
  const playback = usePlaybackTarget();
  // Held HERE because this component RENDERS the provider — see playback/usePlayQueue.ts.
  const playQueue = usePlayQueue();

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
          refused.push(`${file.name} n'est pas un fichier audio`);
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
    [refresh, setError],
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
            enqueue: playQueue.enqueue,
            refresh,
            setError,
          }),
    [
      entries,
      file,
      openFile,
      pickVariant,
      playQueue.enqueue,
      refresh,
      section,
      setError,
    ],
  );

  return (
    /* Wrapping the whole shell: what plays belongs to the TAB (../docs/miniPlayer.md). */
    <PlaybackProvider target={playback.target} playQueue={playQueue}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* The families sit in the header, where st0 puts its views; the bar is @frediverse/ui's. */}
        <AppHeader
          // No `variant`: the house look, the accent tinted over the page.
          title="pl8"
          version={VERSION}
          subtitle={sectionLabel(section)}
          items={sectionItems(section, counts, setSection)}
          className="z-20"
          actions={
            <>
              {/* The tree's drawer button, on a narrow screen only — see ../docs/responsive.md. */}
              {hasTree ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  aria-label="Arborescence"
                  onClick={() => setTreeOpen(true)}
                >
                  <FolderTree className="h-5 w-5" />
                </Button>
              ) : null}
              {/* Where sound comes out, beside the cog: it is changed while listening — see ../docs/playbackTarget.md. */}
              <PlaybackPicker
                target={playback.target}
                onChoose={playback.choose}
              />
              {/* Last, at the far right: the account, the settings, the other apps, the logout (@studio/ui-user-menu). */}
              <UserMenu
                self="pl8"
                email={currentUser()}
                onLogout={() => void auth.logout()}
                onSettings={() => setSection("settings")}
                settingsLabel="Paramètres"
              />
            </>
          }
        />

        {/* The hunt page draws its own scroller, because its history can be long. */}
        {isSettings ? (
          <SettingsPage onBack={() => setSection("songs")} />
        ) : isFind ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <FindSongs
              onBack={() => setSection("songs")}
              onFiled={refreshSongs}
              onOpenSettings={() => setSection("settings")}
            />
          </div>
        ) : isPlaylists ? (
          /* Its own two columns — the set lists, then the open one (../docs/playlists.md). */
          <Playlists
            file={file}
            vimMode={localStorage.getItem("pl8.vim") === "1"}
            target={playback.target}
            onOpen={openFile}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* An engine gate stood here over the Modules section; the section itself is gone (../docs/library.md). */}
            {/* The drawer's veil, which exists only while it is open: an invisible cover swallows clicks. */}
            {treeOpen && (
              <button
                type="button"
                aria-label="Fermer l'arborescence"
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setTreeOpen(false)}
              />
            )}
            {/* A column when there is room and a DRAWER when there is not, same markup — see ../docs/responsive.md. */}
            <aside
              // No translate (breaks FileTree's popup, ../docs/responsive.md) — a column, so the tree scrolls and the foot does not.
              className={`flex shrink-0 flex-col overflow-hidden rounded-xl bg-tree-panel p-3 md:static md:z-auto md:m-3 md:flex md:w-[290px] ${
                treeOpen
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
                    const files = Array.from(e.target.files ?? []).map(
                      (file) => ({
                        path: file.webkitRelativePath || file.name,
                        file,
                      }),
                    );
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
                    if (entry && isSong(entry))
                      openFile(`${n.path}/${SONG_FILE}`);
                  }}
                  // A song wears the glyph of its own tab.
                  icon={(n) => {
                    const e = entryAt(entries, n.path);
                    return e && isSong(e) ? (
                      <Disc3 className="h-4 w-4 shrink-0" />
                    ) : null;
                  }}
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
                              : setError(
                                  "Un fichier n'entre dans les morceaux que comme variante de l'un d'eux : déposez-le sur le morceau.",
                                ))
                        : undefined
                  }
                  // Present, so rows are draggable — folders included, since `moveEntry` renames a directory too.
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
                  cancelLabel="Annuler"
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
                    Trouver des morceaux
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
                  vimMode={localStorage.getItem("pl8.vim") === "1"}
                  playbackTarget={playback.target}
                  onBack={() => openFile(null)}
                  onSaved={refresh}
                />
              </main>
            ) : (
              <LibraryContents
                notice={notice}
                error={error}
                present={present}
                isZone={isZone}
                recordings={recordings}
                entries={entries}
                onOpen={openFile}
              />
            )}

            {/* A third column for a picked MODULE stood here; it went with the family. */}

            {/* A song's variants were a fourth column until clicking a song began to OPEN it (../docs/library.md). */}
          </div>
        )}

        {/* What is playing belongs to the TAB rather than to any screen — see ../docs/miniPlayer.md. */}
        {/* Draws nothing: it is the queue's advance, and it needs the destination. */}
        <QueueAdvance target={playback.target} />
        <MiniPlayer />
      </div>
    </PlaybackProvider>
  );
}
