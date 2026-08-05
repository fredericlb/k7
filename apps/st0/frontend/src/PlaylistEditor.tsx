// PlaylistEditor.tsx — a playlist opened: its YAML as text on the left, the morceaux it names
// as a playable list on the right. The same shape ChainEditor and SongEditor have, for the same
// reason: you edit the file while hearing what it describes. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
} from "@studio/mediatek/playlist";
import type { MediatekEntry } from "@studio/mediatek/types";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, ListMusic, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { PlaylistPane } from "./PlaylistPane";
import type { PlaybackTarget } from "./playback/targets";

/** How often the songs listing is re-read while a playlist is open. The same interval the
 *  catalogue polls at — a morceau filed in another tab should appear here too, and a playlist
 *  is exactly the screen where you notice one is missing. */
const SONGS_POLL_MS = 3000;

export function PlaylistEditor({
  entry,
  vimMode,
  playbackTarget,
  engineToken,
  onBack,
  onSaved,
}: {
  entry: MediatekEntry;
  vimMode: boolean;
  playbackTarget: PlaybackTarget;
  engineToken?: string | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  // A STRING, and that is the point: the listing is re-polled every three seconds, so `entry`
  // is a fresh object on every tick and an effect depending on it would reload the file —
  // throwing away whatever had been typed into it — three times a minute.
  const path = entry.path;
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  /**
   * The songs family, polled beside the file.
   *
   * Its OWN fetch and not something handed down from Library, which holds the listing of the
   * section you are LOOKING at — `playlists` here. Resolving a line needs the other family, and
   * this is the only screen that needs both: the catalogue deliberately invalidates one at a
   * time (see packages/mediatek/docs/playlists.md, "the refs are not checked here"), so this is
   * also the only place where "no such morceau" is answerable at all.
   */
  const [songs, setSongs] = useState<MediatekEntry[] | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = () =>
      void library
        .list("songs")
        .then((l) => !stop && setSongs(l.entries))
        // Left as it was rather than emptied: an unreachable listing for one tick must not
        // turn every line of the playlist into "introuvable".
        .catch(() => {});
    tick();
    const t = setInterval(tick, SONGS_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // Absent is NOT an error, the way a song's missing sidecar is not: the editor opens on what
  // the file WOULD say, and the first save creates it through the ordinary write route. An
  // EMPTY file is the same case — `POST /folder`'s sibling, "Nouveau fichier…", writes one.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setDirty(false);
    setStatus("");
    const name =
      path
        .split("/")
        .pop()
        ?.replace(/\.ya?ml$/i, "") ?? "playlist";
    void library
      .readFile(path)
      .then((f) => {
        if (!alive) return;
        setContent(f.content.trim() ? f.content : playlistStub(name));
        if (!f.content.trim())
          setStatus("fichier vide — enregistrer écrira ce gabarit");
      })
      .catch(() => {
        if (!alive) return;
        setContent(playlistStub(name));
        setStatus("pas encore de fichier — enregistrer le créera");
      });
    return () => {
      alive = false;
    };
  }, [path]);

  /**
   * The lines, as the text CURRENTLY says — not as the last save did.
   *
   * That is the whole point of the split: the right-hand pane follows the keystrokes, the way
   * ChainEditor's graph does.
   */
  const [items, setItems] = useState<PlaylistItem[]>([]);
  useEffect(() => {
    if (content == null) return setItems([]);
    const parsed = parsePlaylist(content);
    // Only ever REPLACED by something readable. Half-typed YAML fails to parse on nearly every
    // keystroke — a closing bracket you have not got to yet — and a pane that emptied itself
    // each time would flicker its way through every line you write. The footer says when what
    // is showing is behind the text.
    if (parsed) setItems(parsed.items);
  }, [content]);
  const broken = useMemo(
    () => content != null && parsePlaylist(content) === null,
    [content],
  );

  const save = useCallback(async () => {
    if (content == null) return;
    setSaving(true);
    try {
      await library.writeFile(path, content);
      setDirty(false);
      setStatus(`enregistré ${path}`);
      onSaved();
    } catch (e) {
      setStatus(`erreur : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [content, path, onSaved]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Retour
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-sm font-semibold">
            <ListMusic className="h-4 w-4" /> Playlist · {entry.name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {path}
          </div>
        </div>
        <Button
          size="sm"
          className="ml-auto"
          variant={dirty ? "default" : "secondary"}
          disabled={saving || content == null}
          onClick={() => void save()}
        >
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Enregistrer{dirty ? " *" : ""}
        </Button>
      </header>

      {content == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 w-1/2 shrink-0 border-r border-border">
            <YamlPane
              path={path}
              content={content}
              vimMode={vimMode}
              onChange={(text) => {
                setContent(text);
                setDirty(true);
              }}
              onSave={() => void save()}
            />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <PlaylistPane
              items={items}
              songs={songs}
              target={playbackTarget}
              engineToken={engineToken}
            />
          </div>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {/* Said here and not over the list: text stops parsing on nearly every keystroke while
            you are typing a line, and a pane that emptied itself each time would flicker. */}
        {broken ? (
          <span className="text-destructive">
            le YAML ne parse pas — la liste montre la dernière version lisible
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
