// Playlists.tsx — the set lists on this volume: the ones it holds down the left, the open one on
// the right as resolved rows, with its YAML one click away. There is no Save button — the file is
// written as soon as the buffer reads as a playlist. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import {
  FileCode2,
  ListMusic,
  Loader2,
  Plus,
  TriangleAlert,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  type ResolvedItem,
  resolveItems,
} from "@studio/mediatek/playlistItems";
import type { PlaylistSummary } from "@studio/mediatek/playlists";
import { type MediatekEntry, PLAYLISTS_DIR } from "@studio/mediatek/types";
import {
  appendMediaPlaylistItem,
  MEDIA_PLAYLIST_EXT,
  moveMediaPlaylistItem,
  parseMediaPlaylist,
  removeMediaPlaylistItem,
} from "@studio/song-schema/mediaYaml";
import type { Playlist } from "@studio/song-schema/playlist";
import type { Validity } from "@studio/song-schema/yaml/validate";
import { useAutosave } from "@studio/ui-editor/autosave";
import { sortNodes } from "@studio/web-protocol/tree";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import { YamlPane } from "./LazyYamlPane";
import { PlaylistRows, rowPath } from "./PlaylistRows";
import { usePlayback } from "./playback/PlaybackProvider";
import { SaveState } from "./SaveState";
import { useServerCopy } from "./ServerCopy";
import { playlistMissing } from "./serverSets";

/** A playlist is a FILE, so the zone's listing becomes a tree the same way a family's does. */
function playlistTree(list: PlaylistSummary[] | null): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const p of list ?? []) {
    const parts = p.path.split("/").filter(Boolean).slice(1);
    let level = roots;
    let sofar = "";
    parts.forEach((part, i) => {
      sofar = sofar ? `${sofar}/${part}` : part;
      const leaf = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        // The leaf's NAME is the title or the bare file name — never the raw segment with its extension.
        node = leaf
          ? { name: p.title || p.name.split("/").pop() || part, path: sofar }
          : { name: part, path: sofar, dir: true, children: [] };
        level.push(node);
      }
      if (!leaf) level = node.children ??= [];
    });
  }
  return roots;
}

/** The listing row a tree path stands for, or null for a folder grouping. */
function summaryAt(
  list: PlaylistSummary[] | null,
  path: string,
): PlaylistSummary | null {
  return (
    (list ?? []).find((p) => p.path === `${PLAYLISTS_DIR}/${path}`) ?? null
  );
}

/** A playlist is judged by its OWN parser, the project-file router knowing nothing of this folder. */
const playlistValidator =
  (unreadable: string) =>
  (_path: string, text: string): Validity => {
    const ok = parseMediaPlaylist(text) !== null;
    return {
      ok,
      issues: ok ? [] : [{ path: "items", message: unreadable }],
      depth: "schema",
      malformed: !ok,
    };
  };

export function Playlists({
  file,
  vimMode,
  onOpen,
}: {
  /** The open playlist, `playlists/`-relative and carrying its extension — null for none. */
  file: string | null;
  vimMode: boolean;
  onOpen: (file: string | null) => void;
}) {
  // This screen is INSIDE the provider, so it drives the transport rather than being handed one.
  const playback = usePlayback();
  const labels = useLabels();
  const l = labels.playlists;
  const validatePlaylist = useMemo(
    () => playlistValidator(l.unreadable),
    [l.unreadable],
  );
  // Loaded HERE: no family stands behind this section, and a line resolves against the SONGS (../docs/playlists.md).
  const [songs, setSongs] = useState<MediatekEntry[] | null>(null);
  const [list, setList] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [showYaml, setShowYaml] = useState(false);

  const path = file ? `playlists/${file}` : null;
  const [content, setContent] = useState<string | null>(null);
  // What is on disk: dirty is derived from the two, never a flag a failed write could leave lying.
  const [saved, setSaved] = useState("");

  const reload = useCallback(async () => {
    try {
      const { playlists } = await library.playlists();
      setList(playlists);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const loadSongs = useCallback(
    (alive: () => boolean = () => true) =>
      library
        .list("songs")
        .then((l) => alive() && setSongs(l.entries))
        // Null stands: "not yet loaded" and "no such song" are different sentences on a row.
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    let alive = true;
    void loadSongs(() => alive);
    return () => {
      alive = false;
    };
  }, [loadSongs]);
  // What the paired server holds and this machine lacks — what a line that resolves to nothing may still find.
  const serverCopy = useServerCopy("songs", songs, setError);

  useEffect(() => {
    if (!path) {
      setContent(null);
      return;
    }
    let alive = true;
    setContent(null);
    void library
      .readFile(path)
      .then((f) => {
        if (!alive) return;
        setContent(f.content);
        setSaved(f.content);
      })
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        onOpen(null);
      });
    return () => {
      alive = false;
    };
  }, [path, onOpen]);

  const write = useCallback(
    async (next: string) => {
      if (!path) return;
      await library.writeFile(path, next);
      setSaved(next);
      // The listing carries the title and the count, both of which this write may have changed.
      void reload();
    },
    [path, reload],
  );
  const autosave = useAutosave({
    path: content == null ? null : path,
    text: content ?? "",
    saved,
    write,
    validate: validatePlaylist,
  });

  // Replaced only by something readable: half-typed YAML fails every other keystroke, and the list would flicker.
  const [doc, setDoc] = useState<Playlist | null>(null);
  useEffect(() => {
    if (content == null) return;
    const parsed = parseMediaPlaylist(content);
    if (parsed) setDoc(parsed);
  }, [content]);
  const behind = content != null && parseMediaPlaylist(content) === null;

  const rows: ResolvedItem[] = useMemo(
    () => resolveItems(doc?.items ?? [], songs),
    [doc, songs],
  );
  const missing = useMemo(
    () => playlistMissing(rows, serverCopy.placement?.serverOnly ?? []),
    [rows, serverCopy.placement],
  );

  /** An edit the TEXT cannot take — an inline `items: [a, b]` — disables the buttons and says why. */
  const frozen =
    content != null && doc && doc.items.length > 1
      ? moveMediaPlaylistItem(content, 0, 1) === null
        ? l.inline
        : ""
      : "";

  /** Every graphical edit goes through the TEXT: the buffer is the document, not a second one. */
  const edit = (next: string | null) => {
    if (next != null) setContent(next);
  };

  const create = async () => {
    const wanted = name.trim();
    if (!wanted) return;
    try {
      const made = await library.newPlaylist(wanted);
      setNaming(false);
      setName("");
      await reload();
      onOpen(`${made.name}${MEDIA_PLAYLIST_EXT}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // A narrow screen shows one of the two columns: the list until a playlist is open, then that playlist (../docs/responsive.md).
  const listIsPage = !file;
  return (
    <div className="flex min-h-0 flex-1">
      {/* The set lists on this volume, as a tree: a playlist is a FILE, and one can nest another. */}
      <aside
        className={`flex-col overflow-hidden rounded-xl bg-tree-panel p-3 md:m-3 md:flex md:w-[290px] md:flex-none md:shrink-0 ${
          listIsPage ? "m-3 flex min-w-0 flex-1" : "hidden"
        }`}
      >
        {/* On a narrow screen the column beside it is not drawn, so its error is said here; a wide one says it there. */}
        {error ? (
          <div className="mb-2 rounded bg-destructive/10 px-2 py-1.5 text-destructive text-sm md:hidden">
            {error}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {list && !list.length ? (
            <p className="p-2 text-sm text-white/70">{l.none}</p>
          ) : (
            <FileTree
              nodes={sortNodes(playlistTree(list))}
              activePath={file}
              // Opens down to the current playlist, so a deep link does not land on a folded folder.
              reveal={file}
              onOpen={(n) => onOpen(n.path)}
              icon={(n) => {
                const p = summaryAt(list, n.path);
                if (!p) return null;
                return p.ok ? (
                  <ListMusic className="h-4 w-4 shrink-0" />
                ) : (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
                );
              }}
              rowEnd={(n) => {
                const p = summaryAt(list, n.path);
                return p ? (
                  <span className="shrink-0 pr-1 text-xs tabular-nums text-white/50">
                    {p.count}
                  </span>
                ) : null;
              }}
            />
          )}
        </div>
        <div className="mt-2 flex shrink-0 flex-col gap-2 border-t border-white/10 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setNaming((n) => !n)}
          >
            <Plus className="mr-1 h-4 w-4" /> {l.newPlaylist}
          </Button>
          {naming ? (
            <Input
              autoFocus
              value={name}
              placeholder={l.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setNaming(false);
              }}
            />
          ) : null}
        </div>
      </aside>

      <section
        className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${listIsPage ? "hidden" : "flex"}`}
      >
        {error ? (
          <div className="border-b bg-destructive/10 px-3 py-1.5 text-destructive text-sm">
            {error}
          </div>
        ) : null}
        {!file ? (
          <div className="flex flex-1 items-center justify-center p-4 text-muted-foreground text-sm">
            {l.choose}
          </div>
        ) : content == null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
            {labels.common.loading}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <ListMusic className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate font-semibold text-sm">
                {doc?.title || file}
              </span>
              <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                {path}
              </span>
              <Button
                variant={showYaml ? "default" : "ghost"}
                size="sm"
                className="ml-auto shrink-0"
                onClick={() => setShowYaml((y) => !y)}
                title={l.showYaml}
              >
                <FileCode2 className="h-4 w-4" />
              </Button>
              <SaveState autosave={autosave} className="shrink-0" />
            </header>
            {/* What is shown is BEHIND the text while the buffer does not read as a playlist. */}
            {behind ? (
              <div className="border-b bg-amber-500/10 px-3 py-1 text-amber-700 text-xs dark:text-amber-400">
                {l.behind}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <PlaylistRows
                  rows={rows}
                  songs={songs}
                  missing={missing.length}
                  // The rows resolve against the local catalogue, so it is read again once they land.
                  onDownloadMissing={() =>
                    serverCopy.download(missing).then(() => loadSongs())
                  }
                  frozen={frozen}
                  onAdd={(song, variant) =>
                    edit(
                      appendMediaPlaylistItem(
                        content,
                        variant ? { song, variant } : { song },
                      ),
                    )
                  }
                  onRemove={(i) => edit(removeMediaPlaylistItem(content, i))}
                  onMove={(from, to) =>
                    edit(moveMediaPlaylistItem(content, from, to))
                  }
                  // One line, the version the line ASKS for — which the queue cannot say.
                  onPlay={(r) => {
                    const path = rowPath(r);
                    if (!r.song || !r.take || !path) return;
                    playback.start({
                      entry: r.song,
                      path,
                      ...(r.take.kind === "master"
                        ? {}
                        : { version: r.take.name }),
                      target: playback.target,
                    });
                  }}
                  playingPath={
                    playback.playing ? (playback.now?.path ?? null) : null
                  }
                  onPause={playback.toggle}
                  // …and the whole list into the QUEUE, which carries masters — ../docs/miniPlayer.md.
                  onQueueAll={() =>
                    playback.enqueue(
                      rows
                        .map((r) => r.song)
                        .filter((s): s is MediatekEntry => s !== null),
                    )
                  }
                />
              </div>
              {showYaml ? (
                <div className="min-h-0 h-1/2 shrink-0 border-t md:h-auto md:w-1/2 md:border-t-0 md:border-l">
                  <YamlPane
                    path={path ?? ""}
                    content={content}
                    vimMode={vimMode}
                    onChange={setContent}
                    onSave={autosave.flush}
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
