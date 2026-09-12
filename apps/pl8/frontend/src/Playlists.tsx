// Playlists.tsx — the set lists on this volume: the ones it holds down the left, the open one on
// the right as resolved rows, with its YAML one click away. There is no Save button — the file is
// written as soon as the buffer reads as a playlist. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import {
  type ResolvedItem,
  resolveItems,
} from "@studio/mediatek/playlistItems";
import type { PlaylistSummary } from "@studio/mediatek/playlists";
import type { MediatekEntry } from "@studio/mediatek/types";
import {
  appendPlaylistItem,
  movePlaylistItem,
  type Playlist,
  parsePlaylist,
  removePlaylistItem,
} from "@studio/song-schema/playlist";
import type { Validity } from "@studio/song-schema/yaml/validate";
import { useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import {
  FileCode2,
  ListMusic,
  Loader2,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { PlaylistRows } from "./PlaylistRows";
import { PlaylistSync } from "./PlaylistSync";
import { usePlayback } from "./playback/PlaybackProvider";
import type { PlaybackTarget } from "./playback/targets";
import { SaveState } from "./SaveState";

/** A playlist is judged by its OWN parser, the project-file router knowing nothing of this folder. */
const validatePlaylist = (_path: string, text: string): Validity => {
  const ok = parsePlaylist(text) !== null;
  return {
    ok,
    issues: ok
      ? []
      : [
          {
            path: "items",
            message: "ce fichier ne se lit pas comme une playlist",
          },
        ],
    depth: "schema",
    malformed: !ok,
  };
};

export function Playlists({
  file,
  vimMode,
  target,
  onOpen,
}: {
  /** The open playlist, `playlists/`-relative and carrying its extension — null for none. */
  file: string | null;
  vimMode: boolean;
  /** Where sound comes out — a `start()` names it, the transport being one per tab. */
  target: PlaybackTarget;
  onOpen: (file: string | null) => void;
}) {
  // This screen is INSIDE the provider, so it drives the transport rather than being handed one.
  const playback = usePlayback();
  // Loaded HERE and not handed down: this section has no family behind it, so the shell holds no
  // listing for it — and a line resolves against the SONGS whichever section is open.
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

  useEffect(() => {
    let alive = true;
    void library
      .list("songs")
      .then((l) => alive && setSongs(l.entries))
      // Null stands: "not yet loaded" and "no such song" are different sentences on a row.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // Recomputed on every keystroke but only REPLACED by something readable: half-typed YAML fails
  // to parse about every other keystroke, and a list that emptied each time would flicker.
  const [doc, setDoc] = useState<Playlist | null>(null);
  useEffect(() => {
    if (content == null) return;
    const parsed = parsePlaylist(content);
    if (parsed) setDoc(parsed);
  }, [content]);
  const behind = content != null && parsePlaylist(content) === null;

  const rows: ResolvedItem[] = useMemo(
    () => resolveItems(doc?.items ?? [], songs),
    [doc, songs],
  );

  /** An edit the TEXT cannot take — an inline `items: [a, b]` — disables the buttons and says why. */
  const frozen =
    content != null && doc && doc.items.length > 1
      ? movePlaylistItem(content, 0, 1) === null
        ? "cette playlist est écrite en ligne : réordonner demande le YAML"
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
      onOpen(`${made.name}.yaml`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* The set lists on this volume. A column and not a dropdown: it is the section's content. */}
      <aside className="w-56 shrink-0 overflow-auto border-r p-2">
        <Button
          variant="secondary"
          size="sm"
          className="mb-2 w-full"
          onClick={() => setNaming((n) => !n)}
        >
          <Plus className="mr-1 h-4 w-4" /> Nouvelle playlist
        </Button>
        {naming ? (
          <div className="mb-2">
            <Input
              autoFocus
              value={name}
              placeholder="été-2026, ou live/répét"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setNaming(false);
              }}
            />
          </div>
        ) : null}
        <ul className="space-y-0.5">
          {(list ?? []).map((p) => (
            <li key={p.path}>
              <button
                type="button"
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent ${
                  file === `${p.name}.yaml` ? "bg-accent" : ""
                }`}
                onClick={() => onOpen(`${p.name}.yaml`)}
              >
                {/* A file that does not parse is listed all the same: hiding it hides the one to fix. */}
                {p.ok ? (
                  <ListMusic className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {p.title || p.name}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {p.count}
                </span>
              </button>
            </li>
          ))}
          {list && !list.length ? (
            <li className="p-2 text-muted-foreground text-sm">
              Aucune playlist ici.
            </li>
          ) : null}
        </ul>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <div className="border-b bg-destructive/10 px-3 py-1.5 text-destructive text-sm">
            {error}
          </div>
        ) : null}
        {!file ? (
          <div className="flex flex-1 items-center justify-center p-4 text-muted-foreground text-sm">
            Choisissez une playlist, ou créez-en une.
          </div>
        ) : content == null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
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
              {/* The sync acts on the PLAYLIST, so it is here and not in the row toolbar below. */}
              <div className="ml-auto shrink-0">
                <PlaylistSync playlist={file.replace(/\.ya?ml$/i, "")} />
              </div>
              <Button
                variant={showYaml ? "default" : "ghost"}
                size="sm"
                className="shrink-0"
                onClick={() => setShowYaml((y) => !y)}
                title="Le fichier, tel qu'il est écrit"
              >
                <FileCode2 className="h-4 w-4" />
              </Button>
              <SaveState autosave={autosave} className="shrink-0" />
            </header>
            {/* What is shown is BEHIND the text while the buffer does not read as a playlist. */}
            {behind ? (
              <div className="border-b bg-amber-500/10 px-3 py-1 text-amber-700 text-xs dark:text-amber-400">
                le texte ne se lit pas comme une playlist — la liste ci-dessous
                est la dernière version lisible
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <PlaylistRows
                  rows={rows}
                  songs={songs}
                  frozen={frozen}
                  onAdd={(song, variant) =>
                    edit(
                      appendPlaylistItem(
                        content,
                        variant ? { song, variant } : { song },
                      ),
                    )
                  }
                  onRemove={(i) => edit(removePlaylistItem(content, i))}
                  onMove={(from, to) =>
                    edit(movePlaylistItem(content, from, to))
                  }
                  // One line, the version the line ASKS for — which the queue cannot say.
                  onPlay={(r) => {
                    if (!r.song || !r.take?.file) return;
                    playback.start({
                      entry: r.song,
                      path: `${r.song.path}/${r.take.file}`,
                      ...(r.take.kind === "master"
                        ? {}
                        : { version: r.take.name }),
                      target,
                    });
                  }}
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
