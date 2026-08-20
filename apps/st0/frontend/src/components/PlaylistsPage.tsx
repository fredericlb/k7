// PlaylistsPage.tsx — the workspace's set lists: every `.yaml` under `_playlists/`, one row
// each, and the screen for one behind a click. Opened from the cog, because a playlist belongs
// to the REPOSITORY rather than to the song you have open. See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  ArrowLeft,
  ListMusic,
  Loader2,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PlaylistInfo } from "../types";
import { PlaylistEditor } from "./PlaylistEditor";

export function PlaylistsPage({
  vimMode,
  onBack,
}: {
  vimMode: boolean;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<PlaylistInfo[] | null>(null);
  const [error, setError] = useState("");
  /** Which one is open, by PATH — the listing is re-read on every save, so holding the row
   *  object would reopen the editor on a fresh identity three times a minute. */
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  const refresh = useCallback(
    () =>
      api
        .playlists()
        .then((r) => {
          setRows(r.playlists);
          setError("");
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(() => {
    const want = name.trim();
    if (!want) return;
    void api
      .createPlaylist(want)
      .then((r) => {
        setCreating(false);
        setName("");
        // Straight into it: an empty playlist exists to be filled, and the screen that fills
        // it is one click away otherwise.
        setOpen(r.path);
        return refresh();
      })
      .catch((e: Error) => setError(e.message));
  }, [name, refresh]);

  if (open) {
    const row = rows?.find((p) => p.path === open);
    return (
      <PlaylistEditor
        path={open}
        name={row?.title || row?.name || open.split("/").pop() || open}
        vimMode={vimMode}
        onBack={() => {
          setOpen(null);
          void refresh();
        }}
        onSaved={() => void refresh()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Retour
        </Button>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListMusic className="h-4 w-4" /> Playlists
        </div>
        <Button
          size="sm"
          variant={creating ? "default" : "secondary"}
          className="ml-auto"
          onClick={() => setCreating((c) => !c)}
        >
          <Plus className="mr-1 h-4 w-4" /> Nouvelle playlist
        </Button>
      </header>

      {creating ? (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2">
          {/* Focused through a ref rather than `autoFocus`, the same way PlaylistPane focuses
              its search field: the attribute steals focus on MOUNT, which is not the same
              event as "the button that opens this was just pressed". */}
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // The shell binds bare keys; a text field must keep its own.
              e.stopPropagation();
              if (e.key === "Escape") setCreating(false);
              if (e.key === "Enter") create();
            }}
            placeholder="nom — l'extension est ajoutée"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" onClick={create} disabled={!name.trim()}>
            Créer
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> chargement…
          </div>
        ) : rows.length === 0 ? (
          <p className="max-w-prose p-4 text-sm text-muted-foreground">
            Ce dépôt ne contient encore aucune playlist. Elles vivent dans{" "}
            <span className="font-mono">_playlists/</span>, à la racine de
            l'espace de travail — donc versionnées avec vos morceaux, et les
            mêmes quel que soit le projet ouvert.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left hover:bg-accent/40"
                  onClick={() => setOpen(p.path)}
                >
                  <ListMusic className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.title || p.name}
                  </span>
                  {/* A file that does not parse is listed anyway, and says so: it is on the
                      disk, and a listing that hid it would leave you unable to click the thing
                      you have to go and repair. Clicking it opens the text, which is the fix. */}
                  {p.ok ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {p.count} morceau{p.count > 1 ? "x" : ""}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                      <TriangleAlert className="h-3 w-3" /> ne parse pas
                    </span>
                  )}
                  <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
                    {p.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
