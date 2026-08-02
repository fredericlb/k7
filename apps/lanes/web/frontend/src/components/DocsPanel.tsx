// DocsPanel.tsx — the "Docs" bottom panel: the notes and to-dos authored on a track or
// module, in two tabs — `context` follows the current selection and holds none of its own,
// `global` aggregates every to-do in the project. Read-only, because docs/todos live in the
// song files like everything else the DAW authors.

import { Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { WebGraph, WebProject } from "../types";

// What the "context" tab points at — a track (timeline caret) or a module (graph tap); null until something is.
export type DocsSelection = { kind: "track" | "module"; id: string } | null;

// One entity's notes/checklist, flattened from either a track or a module so the two tabs treat them uniformly.
interface Entry {
  kind: "track" | "module";
  id: string;
  docs?: string;
  todos: string[];
}

const norm = (docs?: string, todos?: string[]) => ({
  docs: docs?.trim() ? docs : undefined,
  todos: (todos ?? []).filter((t) => t.trim()),
});

export function DocsPanel({
  reloadKey,
  selection,
}: {
  reloadKey: number;
  selection: DocsSelection;
}) {
  const [tab, setTab] = useState<"context" | "global">("context");
  const [project, setProject] = useState<WebProject | null>(null);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both sources: tracks from the compiled project, modules from the graph. Surface a throw rather than blank out.
  useEffect(() => {
    let alive = true;
    Promise.all([api.projectDoc(), api.graph()])
      .then(([p, g]) => {
        if (!alive) return;
        setProject(p);
        setGraph(g);
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Every entity with docs, keyed for the context tab and listed for the global one. Tracks first, then modules.
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const t of project?.tracks ?? [])
      out.push({ kind: "track", id: t.id, ...norm(t.docs, t.todos) });
    for (const [name, m] of Object.entries(graph?.modules ?? {}))
      out.push({ kind: "module", id: name, ...norm(m.docs, m.todos) });
    return out;
  }, [project, graph]);

  const context = useMemo<Entry | null>(() => {
    if (!selection) return null;
    return (
      entries.find(
        (e) => e.kind === selection.kind && e.id === selection.id,
      ) ?? { kind: selection.kind, id: selection.id, todos: [] } // selected but no docs authored
    );
  }, [entries, selection]);

  const withTodos = useMemo(
    () => entries.filter((e) => e.todos.length),
    [entries],
  );
  const totalTodos = useMemo(
    () => withTodos.reduce((n, e) => n + e.todos.length, 0),
    [withTodos],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span className="font-semibold text-primary">Docs</span>
        <div className="ml-1 flex items-center gap-1">
          <Tab active={tab === "context"} onClick={() => setTab("context")}>
            Context
          </Tab>
          <Tab active={tab === "global"} onClick={() => setTab("global")}>
            Global{totalTodos ? ` · ${totalTodos}` : ""}
          </Tab>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <Note className="text-red-400">docs unavailable — {error}</Note>
        ) : tab === "context" ? (
          <ContextView entry={context} />
        ) : (
          <GlobalView entries={withTodos} />
        )}
      </div>
    </div>
  );
}

// The selection's notes and checklist; nothing selected, or nothing written, each says so rather than sitting blank.
function ContextView({ entry }: { entry: Entry | null }) {
  if (!entry) return <Note>{m["docs.selectTrack"]()}</Note>;
  const empty = !entry.docs && !entry.todos.length;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-xs">
        <KindBadge kind={entry.kind} />
        <span className="truncate font-mono text-foreground">{entry.id}</span>
      </div>
      {empty && (
        <Note className="px-0 text-muted-foreground">
          No notes or to-dos on this {entry.kind}.{" "}
          <span className="text-muted-foreground/70">
            Add <code className="font-mono">docs</code> /{" "}
            <code className="font-mono">todos</code> in its file.
          </span>
        </Note>
      )}
      {entry.docs && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {entry.docs}
        </p>
      )}
      {entry.todos.length > 0 && <TodoList items={entry.todos} />}
    </div>
  );
}

// Every to-do in the project, grouped by the track/module it belongs to.
function GlobalView({ entries }: { entries: Entry[] }) {
  if (!entries.length)
    return (
      <Note>
        No to-dos in this project. Add a{" "}
        <code className="font-mono">todos</code> list to any track or module.
      </Note>
    );
  return (
    <div className="flex flex-col gap-3 p-3">
      {entries.map((e) => (
        <div key={`${e.kind}:${e.id}`} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <KindBadge kind={e.kind} />
            <span className="truncate font-mono text-muted-foreground">
              {e.id}
            </span>
          </div>
          <TodoList items={e.todos} />
        </div>
      ))}
    </div>
  );
}

function TodoList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-foreground">
          <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function KindBadge({ kind }: { kind: "track" | "module" }) {
  return (
    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {kind}
    </span>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Note({
  children,
  className = "text-muted-foreground",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`p-4 text-sm ${className}`}>{children}</div>;
}
