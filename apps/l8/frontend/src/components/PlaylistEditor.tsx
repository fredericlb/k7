// PlaylistEditor.tsx — a playlist opened: its YAML as text on the left, the morceaux it names
// as a playable list on the right. The same shape the médiathèque's own screen had, kept on
// purpose — you edit the file while hearing what it describes. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import {
  appendPlaylistItem,
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
} from "@studio/song/playlist";
import type { Validity } from "@studio/song/yaml/validate";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, ListMusic, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, mediatek } from "../api";
import { playlistVocabulary } from "../playlistVocabulary";
import { PlaylistPane } from "./PlaylistPane";

/**
 * Is this text a playlist?
 *
 * A workspace file the project-file router that autosave defaults to knows nothing about —
 * `_playlists/x.yaml` is not a document of the open song. `parsePlaylist` is what does know,
 * and it already answers null for anything it cannot read. Reported as a schema failure rather
 * than malformed text so the escape hatch applies: a playlist already unreadable on disk stays
 * editable.
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

/** What the header says where the Save button was — the same five words EditorTab uses, and
 *  "clean" says nothing for the same reason: a saved file is the ordinary state. */
const SAVE_LABEL: Record<string, string> = {
  clean: "",
  pending: "edited",
  saving: "saving…",
  held: "not saved",
  error: "save failed",
};

/** How often the médiathèque's songs are re-read while a playlist is open. A morceau filed in
 *  another tab should appear here too, and a playlist is exactly the screen where you notice
 *  one is missing. Slower than st0's own poll: this is a cross-app call from an editor. */
const SONGS_POLL_MS = 10_000;

export function PlaylistEditor({
  path,
  name,
  vimMode,
  onBack,
  onSaved,
}: {
  /** The playlist's workspace-relative path (`_playlists/ete-2026.yaml`). */
  path: string;
  /** What the header calls it — the title the listing parsed, else the file's stem. */
  name: string;
  vimMode: boolean;
  onBack: () => void;
  /** The file has reached disk: the listing behind this screen is one row out of date. */
  onSaved: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  // What is on disk. Dirty is `content !== saved`, derived rather than a flag a failed write
  // could leave lying.
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");

  /**
   * The médiathèque's songs, polled beside the file.
   *
   * This screen holds BOTH listings, which is what makes it the only place where "no such
   * morceau" is answerable at all: the playlist is a workspace file and the songs are another
   * service's catalogue, and nothing else in this app has both.
   */
  const [songs, setSongs] = useState<MediatekEntry[] | null>(null);
  const [songsError, setSongsError] = useState("");
  /**
   * Ask the catalogue again.
   *
   * A callback and not a counter in the effect's dependencies: the pane calls this the moment
   * it has filed a song (`onFiled`), so the line it just wrote resolves to something instead of
   * sitting on "morceau introuvable" until the next tick. Threading that through a state bump
   * would restart the interval as well, which is a different thing to want.
   */
  const refreshSongs = useCallback(
    () =>
      mediatek
        .listSongs()
        .then((entries) => {
          setSongs(entries);
          setSongsError("");
        })
        // Left as it was rather than emptied: an unreachable catalogue for one tick must not
        // turn every line of the playlist into "introuvable". Said in the footer, once.
        .catch((e: Error) => setSongsError(e.message)),
    [],
  );
  useEffect(() => {
    void refreshSongs();
    const t = setInterval(() => void refreshSongs(), SONGS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshSongs]);

  // Memoised on the listing itself: the poll hands back a fresh array every time, and the pane
  // holds this in a ref precisely so a new one does not reconfigure the editor — but rebuilding
  // the ref lists on every tick would still be work for nothing.
  const vocabulary = useMemo(() => playlistVocabulary(songs), [songs]);

  // Absent is NOT an error: the editor opens on what the file WOULD say, and the first EDIT
  // creates it through the ordinary write route. An EMPTY file is the same case. The gabarit is
  // `saved` too, deliberately: opening a playlist must not write it by itself.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setStatus("");
    const stem =
      path
        .split("/")
        .pop()
        ?.replace(/\.ya?ml$/i, "") ?? "playlist";
    void api
      .read(path)
      .then((f) => {
        if (!alive) return;
        const disk = f.content.trim() ? f.content : playlistStub(stem);
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
        setContent(recallBuffer(path) ?? playlistStub(stem));
        setSaved(playlistStub(stem));
        setStatus("pas encore de fichier — la première modification le créera");
      });
    return () => {
      alive = false;
    };
  }, [path]);

  /**
   * The lines, as the text CURRENTLY says — not as the last save did.
   *
   * That is the whole point of the split: the right-hand pane follows the keystrokes.
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
   * A morceau picked in the search — or one just uploaded — as a line at the end of the file.
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
  const addItem = useCallback((item: PlaylistItem) => {
    setContent((cur) => {
      if (cur == null) return cur;
      // `addRefusal` keeps the button disabled for the shapes this cannot extend, so getting
      // here means the file changed shape under us. Leaving the text alone is the honest
      // answer; the pane goes on saying why.
      return appendPlaylistItem(cur, item) ?? cur;
    });
  }, []);

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
      await api.write(path, next);
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
            <ListMusic className="h-4 w-4" /> Playlist · {name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {path}
          </div>
        </div>
        {/* Where the Save button was. It says nothing while the file is saved — that is the
            normal state — and stays amber, with the reason, for as long as it is not. The same
            two words EditorTab's toolbar uses, so "not saved" reads the same on both screens. */}
        <span
          className={`ml-auto flex min-w-0 shrink-0 items-center gap-1 text-xs ${
            autosave.status === "held" || autosave.status === "error"
              ? "text-amber-500"
              : "text-muted-foreground"
          }`}
          title={autosave.reason ?? undefined}
        >
          {autosave.status === "saving" && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          )}
          <span className="truncate">{SAVE_LABEL[autosave.status]}</span>
        </span>
      </header>

      {content == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Côte à côte dès qu'il y a la place, EMPILÉ sinon : deux moitiés d'un
              écran de téléphone font deux colonnes où rien ne tient. */}
          <div className="h-1/2 min-h-0 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0">
            <YamlPane
              path={path}
              content={content}
              // The path cannot say what this file is — a playlist is not one of the project's
              // documents — so the vocabulary comes from the catalogue polled above. See
              // ../playlistVocabulary.ts.
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
              onAdd={addItem}
              onFiled={() => void refreshSongs()}
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
        {songsError ? (
          <span className="text-destructive">médiathèque : {songsError}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
