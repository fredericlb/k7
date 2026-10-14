// PlaylistEditor.tsx — a playlist opened: its YAML as text on the left, the morceaux it names
// as a playable list on the right. Two panes on purpose — you edit the file while hearing what
// it describes. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, ListMusic, Loader2 } from "@frediverse/ui/icons";
import type { MediatekEntry } from "@studio/mediatek/types";
import {
  appendPlaylistItem,
  movePlaylistItem,
  type PlaylistItem,
  parsePlaylist,
  playlistStub,
  removePlaylistItem,
} from "@studio/song-schema/playlist";
import type { Validity } from "@studio/song-schema/yaml/validate";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, mediatek } from "../api";
import { m } from "../paraglide/messages.js";
import { playlistVocabulary } from "../playlistVocabulary";
import { pollWhileVisible } from "../visiblePoll";
import { PlaylistPane } from "./PlaylistPane";

/** Is this text a playlist? `parsePlaylist` is what knows, and a failure is reported as a SCHEMA one, so the escape hatch applies. */
const playlistValidity = (text: string): Validity =>
  parsePlaylist(text) === null
    ? {
        ok: false,
        issues: [{ path: "", message: m["pls.notAPlaylist"]() }],
        depth: "schema",
        malformed: false,
      }
    : { ok: true, issues: [], depth: "schema", malformed: false };

/** What the header says in place of a Save button — the same five words EditorTab uses, and 'clean' says nothing for the same reason. */
const SAVE_LABEL: Record<string, string> = {
  clean: "",
  pending: "edited",
  saving: "saving…",
  held: "not saved",
  error: "save failed",
};

/** How often the médiathèque's songs are re-read while a playlist is open — slower than pl8's own poll, this being a cross-app call. */
const SONGS_POLL_MS = 10_000;

export function PlaylistEditor({
  path,
  name,
  vimMode,
  panel = false,
  onBack,
  onSaved,
  onRun,
}: {
  /** The playlist's workspace-relative path (`_playlists/ete-2026.yaml`). */
  path: string;
  /** What the header calls it — the title the listing parsed, else the file's stem. */
  name: string;
  vimMode: boolean;
  /** Draw as the right-hand PANEL rather than as the page: no header, no YAML half — a mode, everything under the layout being the same (../docs/playlists.md). */
  panel?: boolean;
  /** Back to the listing. Unused in `panel` mode, where there is nothing to go back to. */
  onBack?: () => void;
  /** The file has reached disk: the listing behind this screen is one row out of date. */
  onSaved: () => void;
  /** Dispatch a command line, passed straight through to the songs pane — optional, so neither host has to invent a shell. */
  onRun?: (line: string) => Promise<void>;
}) {
  const [content, setContent] = useState<string | null>(null);
  // What is on disk; dirty is `content !== saved`, derived rather than a flag a failed write could leave lying.
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");

  /** The médiathèque's songs, polled beside the file — this screen holds BOTH listings, which is what makes 'no such morceau' answerable. */
  const [songs, setSongs] = useState<MediatekEntry[] | null>(null);
  const [songsError, setSongsError] = useState("");
  /** Ask the catalogue again — a callback and not a dependency, since a state bump would restart the interval as well. */
  const refreshSongs = useCallback(
    () =>
      mediatek
        .listSongs()
        .then((entries) => {
          setSongs(entries);
          setSongsError("");
        })
        // Left as it was rather than emptied: an unreachable catalogue for one tick must not make every line 'introuvable'.
        .catch((e: Error) => setSongsError(e.message)),
    [],
  );
  useEffect(() => {
    void refreshSongs();
    return pollWhileVisible(() => void refreshSongs(), SONGS_POLL_MS);
  }, [refreshSongs]);

  // Memoised on the listing itself: the poll hands back a fresh array every time, and rebuilding the ref lists per tick is work for nothing.
  const vocabulary = useMemo(() => playlistVocabulary(songs), [songs]);

  // Absent is NOT an error: the editor opens on what the file WOULD say, and the gabarit is `saved` too, so opening writes nothing.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setStatus("");
    const stem =
      path
        .split("/")
        .pop()
        ?.replace(/\.(?:ya?ml|k7x)$/i, "") ?? "playlist";
    void api
      .read(path)
      .then((f) => {
        if (!alive) return;
        const disk = f.content.trim() ? f.content : playlistStub(stem);
        // An edit that could not be written outlived this screen — give it back, not disk.
        setContent(recallBuffer(path) ?? disk);
        setSaved(disk);
        if (!f.content.trim()) setStatus(m["pls.emptyFile"]());
      })
      .catch(() => {
        if (!alive) return;
        setContent(recallBuffer(path) ?? playlistStub(stem));
        setSaved(playlistStub(stem));
        setStatus(m["pls.noFileYet"]());
      });
    return () => {
      alive = false;
    };
  }, [path]);

  /** The lines, as the text CURRENTLY says — not as the last save did, which is the whole point of the split. */
  const [items, setItems] = useState<PlaylistItem[]>([]);
  useEffect(() => {
    if (content == null) return setItems([]);
    const parsed = parsePlaylist(content);
    // Only ever REPLACED by something readable: half-typed YAML fails on nearly every keystroke, and the footer says when the pane is behind.
    if (parsed) setItems(parsed.items);
  }, [content]);
  const broken = useMemo(
    () => content != null && parsePlaylist(content) === null,
    [content],
  );

  /** A morceau picked in the search, as a line at the end of the file: the EDIT is the TEXT, so the row appears because the buffer changed. */
  const addItem = useCallback((item: PlaylistItem) => {
    setContent((cur) => {
      if (cur == null) return cur;
      // `addRefusal` keeps the button disabled for the shapes this cannot extend, so getting here means the file changed shape under us.
      return appendPlaylistItem(cur, item) ?? cur;
    });
  }, []);

  /** Why the search cannot write a line right now — computed HERE, being a fact about the text the pane has never seen. */
  const addRefusal = useMemo(() => {
    if (content == null) return m["pls.notLoaded"]();
    return appendPlaylistItem(content, { song: "x" }) === null
      ? m["pls.addUnsupported"]()
      : "";
  }, [content]);

  /** Drop a line, by the position the pane draws — the same TEXT edit `playlist song remove` makes. */
  const removeItem = useCallback((index: number) => {
    setContent((cur) =>
      cur == null ? cur : (removePlaylistItem(cur, index) ?? cur),
    );
  }, []);

  /** Reorder, likewise: the buffer is what changes, and the row moves because the text did. */
  const moveItem = useCallback((from: number, to: number) => {
    setContent((cur) =>
      cur == null ? cur : (movePlaylistItem(cur, from, to) ?? cur),
    );
  }, []);

  /** Why those two would not work — a flow `items:` the text edit will not reflow (docs/playlists.md). */
  const editRefusal = useMemo(() => {
    if (content == null) return m["pls.notLoaded"]();
    return removePlaylistItem(content, 0) === null && items.length
      ? m["pls.moveUnsupported"]()
      : "";
  }, [content, items.length]);

  // No Save button: written as soon as the buffer reads as a playlist.
  const write = useCallback(
    async (next: string) => {
      await api.write(path, next);
      setSaved(next);
      setStatus(m["pls.saved"]({ path }));
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
      {panel ? null : (
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
          {/* In place of a Save button: silent while saved, amber with the reason otherwise, in EditorTab's own two words. */}
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
      )}

      {content == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Side by side when there is room, STACKED otherwise, and absent in the panel, where neither half fits — see `panel`. */}
          {panel ? null : (
            <div className="h-1/2 min-h-0 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0">
              <YamlPane
                path={path}
                content={content}
                // The path cannot say what this file is, so the vocabulary comes from the catalogue polled above (../playlistVocabulary.ts).
                vocabulary={vocabulary}
                vimMode={vimMode}
                onChange={setContent}
                onSave={autosave.flush}
              />
            </div>
          )}
          <div className="min-h-0 min-w-0 flex-1">
            <PlaylistPane
              items={items}
              songs={songs}
              onAdd={addItem}
              addRefusal={addRefusal}
              onRemove={removeItem}
              onMove={moveItem}
              editRefusal={editRefusal}
              onRun={onRun}
            />
          </div>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {/* Said here and not over the list: text stops parsing on nearly every keystroke, and a pane emptying itself each time would flicker. */}
        {broken ? (
          <span className="text-destructive">{m["pls.brokenYaml"]()}</span>
        ) : null}
        {songsError ? (
          <span className="text-destructive">
            {m["pls.library"]()} : {songsError}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
