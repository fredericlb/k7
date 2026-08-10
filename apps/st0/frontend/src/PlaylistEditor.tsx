// PlaylistEditor.tsx — a playlist opened: its YAML as text on the left, the morceaux it names
// as a playable list on the right. The same shape ChainEditor and SongEditor have, for the same
// reason: you edit the file while hearing what it describes. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  appendPlaylistItem,
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
} from "@studio/mediatek/playlist";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { Validity } from "@studio/song/yaml/validate";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, ListMusic, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { PlaylistPane } from "./PlaylistPane";
import type { PlaybackTarget } from "./playback/targets";
import { playlistVocabulary } from "./playlistVocabulary";
import { SaveState } from "./SaveState";

/**
 * Is this text a playlist?
 *
 * The médiathèque's own file, so the project-file router that autosave defaults to knows
 * nothing about it — `parsePlaylist` is what does, and it already answers null for anything it
 * cannot read. Reported as a schema failure rather than malformed text so the escape hatch
 * applies: a playlist already unreadable on disk stays editable.
 */
const playlistValidity = (text: string): Validity =>
  parsePlaylist(text) === null
    ? {
        ok: false,
        issues: [{ path: "", message: "ne se lit pas comme une playlist" }],
        depth: "schema",
        malformed: false,
      }
    : { ok: true, issues: [], depth: "schema", malformed: false };

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
  // What is on disk. Dirty is `content !== saved`, derived rather than a flag a failed write
  // could leave lying.
  const [saved, setSaved] = useState("");
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

  // Memoised on the listing itself: the poll above hands back a fresh array every three
  // seconds, and the pane holds this in a ref precisely so a new one does not reconfigure the
  // editor — but rebuilding the ref lists on every tick would still be work for nothing.
  const vocabulary = useMemo(() => playlistVocabulary(songs), [songs]);

  // Absent is NOT an error, the way a song's missing sidecar is not: the editor opens on what
  // the file WOULD say, and the first EDIT creates it through the ordinary write route. An
  // EMPTY file is the same case — `POST /folder`'s sibling, "Nouveau fichier…", writes one.
  // The gabarit is `saved` too, deliberately: opening a playlist must not write it by itself.
  useEffect(() => {
    let alive = true;
    setContent(null);
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
        const disk = f.content.trim() ? f.content : playlistStub(name);
        // An edit that could not be written outlived this screen — give it back, not disk.
        setContent(recallBuffer(path) ?? disk);
        setSaved(disk);
        if (!f.content.trim())
          setStatus(
            "fichier vide — la première modification écrira ce gabarit",
          );
      })
      .catch(() => {
        if (!alive) return;
        setContent(recallBuffer(path) ?? playlistStub(name));
        setSaved(playlistStub(name));
        setStatus("pas encore de fichier — la première modification le créera");
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

  /**
   * A morceau picked in the search, as a line at the end of the file.
   *
   * The EDIT is the text, not a list this component holds beside it: the pane on the right is
   * drawn from the buffer, so writing the line into the buffer is what makes the row appear.
   * Anything else would be two sources of truth for one document, and the YamlPane on the left
   * would go on showing the old one.
   *
   * Adding is an edit like typing is, so it reaches disk the way typing does: on its own, once
   * the buffer reads as a playlist. A half-typed line elsewhere in the file holds BOTH back,
   * which is the point — the file is written whole or not at all.
   */
  const addItem = useCallback(
    (item: PlaylistItem) => {
      if (content == null) return;
      const next = appendPlaylistItem(content, item);
      // `addRefusal` keeps the button disabled for the shapes this cannot extend, so getting
      // here means the file changed shape under us. Leaving the text alone is the honest
      // answer; the pane goes on saying why.
      if (next == null) return;
      setContent(next);
    },
    [content],
  );

  /** Why the search cannot write a line right now — computed HERE, because it is a fact about
   *  the text and the pane has never seen it. */
  const addRefusal = useMemo(() => {
    if (content == null) return "fichier pas encore chargé";
    return appendPlaylistItem(content, { song: "x" }) === null
      ? "l'écriture de `items:` dans ce fichier n'est pas une forme que l'ajout sait étendre — ajoutez la ligne à la main"
      : "";
  }, [content]);

  // No Save button: written as soon as the buffer reads as a playlist.
  const write = useCallback(
    async (next: string) => {
      await library.writeFile(path, next);
      setSaved(next);
      setStatus(`enregistré ${path}`);
      onSaved();
    },
    [path, onSaved],
  );
  const autosave = useAutosave({
    path: content == null ? null : path,
    text: content ?? "",
    saved,
    write,
    validate: (_path, text) => playlistValidity(text),
  });

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
        <SaveState autosave={autosave} className="ml-auto shrink-0" />
      </header>

      {content == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Côte à côte dès qu'il y a la place, EMPILÉ sinon : deux moitiés d'un
              écran de téléphone font deux colonnes où rien ne tient. */}
          <div className="min-h-0 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0 h-1/2">
            <YamlPane
              path={path}
              content={content}
              // The path cannot say what this file is — a playlist is the médiathèque's, not
              // a l8 project's — so the vocabulary comes from the listing already polled
              // above. See ./playlistVocabulary.ts.
              vocabulary={vocabulary}
              vimMode={vimMode}
              onChange={setContent}
              onSave={autosave.flush}
            />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <PlaylistPane
              items={items}
              songs={songs}
              target={playbackTarget}
              engineToken={engineToken}
              onAdd={addItem}
              addRefusal={addRefusal}
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
