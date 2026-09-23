// PlaylistsPanel.tsx — the workspace's set lists as a PANEL anchored at the right: a searchable
// dropdown naming one, and its songs under it. Docked beside the panes rather than covering
// them, because it is something you keep open while you work.
//
// Its OWN panel and not a tab of the settings one: settings are things you set and leave, and a
// set list is a thing you work FROM — you open it to put a record on, not to configure
// anything. It also has the one header that is not
// a title (a dropdown, a ＋ and the text button), which a shared tab strip has nowhere to put.
// See ../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import {
  ChevronDown,
  ListMusic,
  Loader2,
  Maximize2,
  Plus,
  TriangleAlert,
  X,
} from "@frediverse/ui/icons";
import { playlistPathOf } from "@studio/song-schema/playlist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { fuzzyScore } from "../fuzzy";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import type { PlaylistInfo } from "../types";
import { PlaylistEditor } from "./PlaylistEditor";
import { type TreeNode, TreePicker } from "./TreePicker";

/** How many playlists the dropdown's search lists before it stops — the same cap the module picker uses, and for the same reason. */
const SEARCH_LIMIT = 40;

/** What a playlist reads as in the dropdown — its title if the file states one, else the filename, with the path muted beside it. */
const nodeOf = (p: PlaylistInfo): TreeNode<PlaylistInfo> => ({
  key: p.path,
  label: p.title || p.name,
  hint: p.path,
  entry: p,
});

/** The dropdown's search: fuzzy over the name AND the path, best first, with the shell's one matcher. */
export function searchPlaylists(
  rows: PlaylistInfo[],
  query: string,
): TreeNode<PlaylistInfo>[] {
  const q = query.trim();
  if (!q) return [];
  return rows
    .map((p) => ({
      p,
      score: Math.max(fuzzyScore(q, p.title || p.name), fuzzyScore(q, p.path)),
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_LIMIT)
    .map((r) => nodeOf(r.p));
}

export function PlaylistsPanel({
  vimMode,
  onRun,
  onClose,
}: {
  vimMode: boolean;
  /** Run a command line through the shell — what « Nouvelle playlist » dispatches, so the palette reaches it (../docs/shell.md). */
  onRun: (line: string) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PlaylistInfo[] | null>(null);
  const [error, setError] = useState("");
  /** Which one the panel is showing, by PATH — the listing is re-read on every save, so a row object would be a fresh identity. */
  const [open, setOpen] = useState<string | null>(null);
  /** Where to put the dropdown, in viewport coords, or null when it is closed. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** The FULL editor, over the shell: the panel is too narrow for the YAML, and the page is the escape hatch for what it cannot edit (../docs/playlists.md). */
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  // Answers the listing as well as storing it: `create` has to know the playlist is really there before opening it.
  const refresh = useCallback(
    (): Promise<PlaylistInfo[] | null> =>
      api
        .playlists()
        .then((r) => {
          setRows(r.playlists);
          setError("");
          return r.playlists;
        })
        .catch((e: Error) => {
          setError(e.message);
          return null;
        }),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Land on one as soon as there is one to land on — only while nothing is chosen, so a re-read never moves you off. */
  useEffect(() => {
    if (open === null && rows?.length) setOpen(rows[0].path);
  }, [rows, open]);

  const tree = useMemo(() => (rows ?? []).map(nodeOf), [rows]);
  const current = rows?.find((p) => p.path === open) ?? null;

  /** `playlist new <name>` — the button dispatches the command, and `playlistPathOf` derives where it lands, a command answering in prose. */
  const create = useCallback(() => {
    const want = name.trim();
    if (!want) return;
    const rel = playlistPathOf(want);
    void onRun(`playlist new ${want}`)
      .then(() => refresh())
      .then((list) => {
        setCreating(false);
        setName("");
        // Straight into it — but only if it is really there: a refused create must not show a panel for a file nobody wrote.
        if (rel && list?.some((p) => p.path === rel)) setOpen(rel);
      })
      .catch((e: Error) => setError(e.message));
  }, [name, onRun, refresh]);

  if (expanded && open)
    return (
      <div className="absolute inset-0 z-40 bg-background">
        <PlaylistEditor
          path={open}
          name={current?.title || current?.name || open}
          vimMode={vimMode}
          onBack={() => {
            setExpanded(false);
            void refresh();
          }}
          onSaved={() => void refresh()}
          onRun={onRun}
        />
      </div>
    );

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />

        {/* The dropdown is a BUTTON opening the module picker's searchable popup, not a <select>: the list is as long as the repository is old. */}
        <button
          ref={pickRef}
          type="button"
          disabled={!rows?.length}
          onClick={() => {
            const r = pickRef.current?.getBoundingClientRect();
            if (r) setMenu({ x: r.left, y: r.bottom + 4 });
          }}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-sm hover:bg-accent disabled:opacity-50"
          title={current?.path ?? m["pls.none"]()}
        >
          <span className="min-w-0 flex-1 truncate">
            {rows === null
              ? m["pls.loading"]()
              : (current?.title ?? current?.name ?? m["pls.none"]())}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        <Button
          size="icon"
          variant={creating ? "default" : "ghost"}
          title={m["pls.new"]()}
          aria-label={m["pls.new"]()}
          onClick={() => setCreating((c) => !c)}
        >
          <Plus className="h-4 w-4" />
        </Button>
        {/* The text, when the panel cannot do what you need — see `expanded`. */}
        <Button
          size="icon"
          variant="ghost"
          disabled={!open}
          title={m["pls.editFile"]()}
          aria-label={m["pls.editFileShort"]()}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {creating ? (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
          {/* Focused through a ref rather than `autoFocus`, which steals focus on MOUNT — not the same event as the opening press. */}
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // the shell binds bare keys; a field keeps its own
              if (e.key === "Escape") setCreating(false);
              if (e.key === "Enter") create();
            }}
            placeholder={m["pls.namePlaceholder"]()}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" onClick={create} disabled={!name.trim()}>
            {m["common.create"]()}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="shrink-0 border-b px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {current && !current.ok ? (
        <p className="flex shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1.5 text-xs text-destructive">
          <TriangleAlert className="h-3 w-3 shrink-0" /> {m["pls.brokenFile"]()}
        </p>
      ) : null}

      {/* The songs, under the dropdown: `PlaylistEditor` in panel mode, the same document and autosave with the YAML half left out. */}
      <div className="min-h-0 flex-1">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {m["pls.loading"]()}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {parts((h) => m["pls.emptyRepo"](h), {
              dir: <span className="font-mono">_playlists/</span>,
            })}
          </p>
        ) : open ? (
          <PlaylistEditor
            key={open}
            path={open}
            name={current?.title || current?.name || open}
            vimMode={vimMode}
            panel
            onSaved={() => void refresh()}
            onRun={onRun}
          />
        ) : null}
      </div>

      {menu && rows ? (
        <TreePicker<PlaylistInfo>
          x={menu.x}
          y={menu.y}
          tree={tree}
          search={(q) => searchPlaylists(rows, q)}
          searchLimit={SEARCH_LIMIT}
          placeholder={m["pls.search"]()}
          emptyLabel={m["pls.none"]()}
          onPick={(p) => setOpen(p.path)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </aside>
  );
}
