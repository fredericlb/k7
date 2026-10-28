// SongsLibrary.tsx — the songs family's screen: the table the width of the screen (SongTable.tsx),
// or, once a song is opened from it, that song's page in its place, Back returning to the table.
// It has no tree: the songs' shape is deduced from tags, so a folder view had nothing to say a
// table does not say better. What it shows of the volume is MediaLibrary's. See ../docs/library.md.

import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import type { RecordingDay } from "@studio/mediatek/recordings";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import { useCallback, useMemo, useRef } from "react";
import { AddSong } from "./AddSong";
import { library } from "./api";
import { useSongLists } from "./favorites";
import { useLibraryHost } from "./host";
import { LibraryContents } from "./LibraryContents";
import { entryAt, isSong, relative } from "./libraryTree";
import { usePlayback } from "./playback/PlaybackProvider";
import { folderOf } from "./routes";
import type { useServerCopy } from "./ServerCopy";
import { SongEditor } from "./SongEditor";
import { SongTable } from "./SongTable";
import { fileAsMaster, splitDrop } from "./songMaster";
import { songTable } from "./songRows";
import { songActions } from "./treeActions";
import { useSongTap } from "./useSongTap";

export function SongsLibrary(p: {
  /** The address's file: a song's sidecar opens its page. */
  file: string | null;
  openFile: (rel: string | null) => void;
  entries: MediatekEntry[] | null;
  /** The paired server's songs this machine lacks, filed among these. */
  remote: MediatekEntry[];
  present: boolean | null;
  manage: boolean;
  notice: string | null;
  error: string | null;
  setError: (message: string) => void;
  refresh: () => void;
  recordings: RecordingDay[];
  serverCopy: ReturnType<typeof useServerCopy>;
  onOpenSettings: () => void;
}) {
  const { file, openFile, entries, remote, refresh, setError, manage } = p;
  const { labels } = useLibraryHost();
  // The account's starred songs and albums and its practice list, which order the table (../docs/library.md).
  const { fav, practice } = useSongLists(setError);
  const groups = useMemo(
    () => songTable(entries, remote, practice.favorites, fav.favorites),
    [entries, remote, practice.favorites, fav.favorites],
  );
  // DERIVED from the route rather than held beside it, so a deep link needs no replay — see ../docs/routing.md.
  const editingSong = useMemo(() => {
    const dir = folderOf(file);
    const entry = dir ? entryAt(entries, dir) : null;
    return entry && isSong(entry) ? entry : null;
  }, [entries, file]);
  // The queue and the destination are the provider's, above this screen.
  const playback = usePlayback();
  // A song just added opens on its page: the address first, the screen once the listing has it.
  const openCreated = useCallback(
    (folder: string) => openFile(`${relative(folder)}/${SONG_FILE}`),
    [openFile],
  );
  // A tap opens the song; a double tap on a touch screen plays it instead (../docs/responsive.md).
  const tapSong = useSongTap(
    useCallback(
      (entry: MediatekEntry) =>
        openFile(`${relative(entry.path)}/${SONG_FILE}`),
      [openFile],
    ),
  );

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
      for (const f of files) {
        if (!isAudio(f.name)) {
          refused.push(labels.tree.notAudio(f.name));
          continue;
        }
        try {
          added.push((await library.addVariant(`songs/${songPath}`, f)).path);
        } catch (e) {
          refused.push((e as Error).message);
        }
      }
      // Before the errors below: it clears the message, and what it clears must be the OLD one.
      refresh();
      if (refused.length) setError(refused.join(" · "));
      // The waveform, the onsets and the tempo, never awaited and best effort (packages/audio-analysis/docs/analysis.md).
      for (const path of added) void library.analyse(path).catch(() => {});
    },
    [refresh, setError, labels],
  );

  /** A drop on a song: its master first when it has none, then the rest as variants (./songMaster.ts). */
  const dropOnSong = useCallback(
    async (songPath: string, files: File[]) => {
      const entry = entryAt(entries, songPath);
      const { master, variants } = splitDrop(entry, files);
      if (entry && master) {
        try {
          const path = await fileAsMaster(entry, master);
          if (path) void library.analyse(path).catch(() => {});
        } catch (e) {
          refresh();
          setError((e as Error).message);
          return;
        }
      }
      if (variants.length) await addVariants(songPath, variants);
      else refresh();
    },
    [entries, addVariants, refresh, setError],
  );

  /** A row's ⋮: the same actions the songs' tree offered (./treeActions.ts). */
  const songMenu = useMemo(
    () =>
      songActions({
        section: "songs",
        entries,
        file,
        openFile,
        pickVariant,
        enqueue: playback.enqueue,
        serverOnly: remote,
        download: p.serverCopy.download,
        refresh,
        setError,
        labels,
        manage,
        favorites: fav.ready ? fav.favorites : null,
        toggleFavorite: fav.toggle,
        practice: practice.ready ? practice.favorites : null,
        togglePractice: practice.toggle,
      }),
    [
      fav.ready,
      fav.favorites,
      fav.toggle,
      practice.ready,
      practice.favorites,
      practice.toggle,
      manage,
      entries,
      file,
      openFile,
      pickVariant,
      playback.enqueue,
      remote,
      p.serverCopy.download,
      refresh,
      setError,
      labels,
    ],
  );

  const addSong = (
    <AddSong
      onDone={refresh}
      onCreated={openCreated}
      onOpenSettings={p.onOpenSettings}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The file input the variant menu opens: one audio file or several, filed as versions. */}
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
      {editingSong ? (
        <SongEditor
          entry={editingSong}
          playbackTarget={playback.target}
          onBack={() => openFile(null)}
          onSaved={refresh}
          manage={manage}
        />
      ) : (
        <LibraryContents
          notice={p.notice}
          error={p.error}
          present={p.present}
          isZone={false}
          recordings={p.recordings}
          entries={entries}
          serverCopy={p.serverCopy}
          onOpen={openFile}
          emptyActions={addSong}
          list={
            <SongTable
              groups={groups}
              practice={practice.favorites}
              favorites={fav.favorites}
              togglePractice={practice.toggle}
              toggleFavorite={fav.toggle}
              actions={songMenu}
              onOpen={tapSong}
              onDrop={(rel, files) => void dropOnSong(rel, files)}
              onDownload={p.serverCopy.download}
              actionsBar={addSong}
            />
          }
        />
      )}
    </div>
  );
}
